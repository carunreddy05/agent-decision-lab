import type { RoutingDecision, RoutingRequest } from "@/domain/route";
import type { EscalationInfo, EscalationReason, HybridMeta } from "@/domain/trace";
import {
  HybridFallbackFailedError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from "@/domain/errors";
import { assertValidRoutingDecision } from "@/domain/validate";
import { ClaudeRouterProvider } from "@/providers/claude/claude-router-provider";
import { JevRouterProvider } from "@/providers/jev/jev-router-provider";
import type { RouterProvider } from "@/providers/router-provider";

/**
 * Threshold is Hybrid-strategy configuration, not a property of Jev or any
 * provider — see phase6-hybrid-design.md §7. `run-decision.ts` re-exports
 * this rather than duplicating it, so the single-provider path's cosmetic
 * escalation display and Hybrid's actual behavior share one default.
 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

type FallbackReason = Extract<
  EscalationReason,
  "UNCERTAINTY_FALLBACK" | "MISSING_CONFIDENCE_FALLBACK" | "TECHNICAL_FAILURE_FALLBACK"
>;

export interface HybridRoutingOptions {
  /** Injectable for tests; defaults to real providers. */
  jevProvider?: RouterProvider;
  claudeProvider?: RouterProvider;
  confidenceThreshold?: number;
}

export interface HybridRoutingResult {
  finalDecision: RoutingDecision;
  /** Absent only when Jev failed technically before producing a decision. */
  initialDecision?: RoutingDecision;
  /** Present only when Claude was actually called. */
  claudeDecision?: RoutingDecision;
  escalation: EscalationInfo;
  hybridMeta: HybridMeta;
}

/**
 * Composes the two independently-verified providers (Jev, Claude) into a
 * single routing decision. This module owns *which provider to call and
 * which decision becomes final*; it never reaches into provider internals,
 * and neither provider is aware it's sometimes called from here — see
 * phase6-hybrid-design.md for the full design rationale.
 *
 * Claude always receives the original, unmodified prompt — never Jev's
 * route, confidence, probabilities, or any hint that Jev was called at all.
 * It independently solves the same routing problem using the same
 * routing-spec-v1 semantics its own adapter already applies.
 */
export async function decideHybrid(
  request: RoutingRequest,
  options: HybridRoutingOptions = {},
): Promise<HybridRoutingResult> {
  const threshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error(`confidenceThreshold must be between 0 and 1 (got ${String(threshold)}).`);
  }
  const jevProvider = options.jevProvider ?? new JevRouterProvider();
  const claudeProvider = options.claudeProvider ?? new ClaudeRouterProvider();

  const overallStart = Date.now();
  const jevStart = Date.now();
  let initialDecision: RoutingDecision | undefined;
  let initialError: unknown;
  try {
    initialDecision = assertValidRoutingDecision(await jevProvider.decide(request));
  } catch (error) {
    initialError = error;
  }
  const initialAttemptLatencyMs = Date.now() - jevStart;

  if (!initialDecision) {
    // Jev failed technically. Only the transient/runtime categories are
    // fallback-eligible — see phase6-hybrid-design.md §4/§5: authentication,
    // authorization, billing, malformed-request, and malformed-output
    // failures indicate our own setup or contract is broken, and silently
    // substituting Claude would hide exactly that (as real Jev/Claude
    // account issues in Phase 4/5 would have been hidden by a softer
    // fallback policy).
    if (!isFallbackEligible(initialError)) {
      throw initialError;
    }
    return fallbackToClaude({
      reason: "TECHNICAL_FAILURE_FALLBACK",
      threshold,
      initialDecision: undefined,
      initialErrorCategory: errorCategoryOf(initialError),
      initialAttemptLatencyMs,
      overallStart,
      claudeProvider,
      request,
    });
  }

  if (initialDecision.confidence === undefined) {
    // Not "confidence is 0," not "uncertain" — a distinct strategy-level
    // inability to evaluate this decision against the threshold at all.
    return fallbackToClaude({
      reason: "MISSING_CONFIDENCE_FALLBACK",
      threshold,
      initialDecision,
      initialErrorCategory: undefined,
      initialAttemptLatencyMs,
      overallStart,
      claudeProvider,
      request,
    });
  }

  if (initialDecision.confidence >= threshold) {
    return {
      finalDecision: initialDecision,
      initialDecision,
      claudeDecision: undefined,
      escalation: {
        triggered: false,
        reason: "CONFIDENCE_ABOVE_THRESHOLD",
        threshold,
        detail: `Jev confidence ${initialDecision.confidence} >= threshold ${threshold} — no fallback.`,
      },
      hybridMeta: {
        totalLatencyMs: Date.now() - overallStart,
        totalEstimatedCostUsd: initialDecision.usage?.estimatedCostUsd ?? 0,
      },
    };
  }

  return fallbackToClaude({
    reason: "UNCERTAINTY_FALLBACK",
    threshold,
    initialDecision,
    initialErrorCategory: undefined,
    initialAttemptLatencyMs,
    overallStart,
    claudeProvider,
    request,
  });
}

function isFallbackEligible(error: unknown): boolean {
  return (
    error instanceof ProviderTimeoutError ||
    error instanceof ProviderRateLimitError ||
    error instanceof ProviderUnavailableError
  );
}

function errorCategoryOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

async function fallbackToClaude(params: {
  reason: FallbackReason;
  threshold: number;
  initialDecision: RoutingDecision | undefined;
  initialErrorCategory: string | undefined;
  initialAttemptLatencyMs: number;
  overallStart: number;
  claudeProvider: RouterProvider;
  request: RoutingRequest;
}): Promise<HybridRoutingResult> {
  const {
    reason,
    threshold,
    initialDecision,
    initialErrorCategory,
    initialAttemptLatencyMs,
    overallStart,
    claudeProvider,
    request,
  } = params;

  let claudeDecision: RoutingDecision;
  try {
    // `request` is the original, unmodified RoutingRequest — Claude gets
    // nothing from Jev's attempt, per the approved design.
    claudeDecision = assertValidRoutingDecision(await claudeProvider.decide(request));
  } catch (claudeError) {
    throw new HybridFallbackFailedError(
      reason,
      initialDecision?.route,
      initialDecision?.confidence,
      initialErrorCategory,
      errorCategoryOf(claudeError),
    );
  }

  return {
    finalDecision: claudeDecision,
    initialDecision,
    claudeDecision,
    escalation: {
      triggered: true,
      reason,
      threshold,
      detail: escalationDetailFor(reason, initialDecision),
    },
    hybridMeta: {
      // Only recorded when Jev never produced a decision — the success
      // case's attempt latency already lives on decision.jev.latencyMs.
      ...(initialDecision === undefined ? { initialErrorCategory, initialAttemptLatencyMs } : {}),
      totalLatencyMs: Date.now() - overallStart,
      totalEstimatedCostUsd:
        (initialDecision?.usage?.estimatedCostUsd ?? 0) + (claudeDecision.usage?.estimatedCostUsd ?? 0),
    },
  };
}

function escalationDetailFor(reason: FallbackReason, initialDecision: RoutingDecision | undefined): string {
  switch (reason) {
    case "TECHNICAL_FAILURE_FALLBACK":
      return "Jev failed with a transient/runtime error — escalated to Claude.";
    case "MISSING_CONFIDENCE_FALLBACK":
      return "Jev returned a decision with no confidence signal — escalated to Claude (not treated as low confidence).";
    case "UNCERTAINTY_FALLBACK":
      return `Jev confidence ${String(initialDecision?.confidence)} below threshold — escalated to Claude.`;
  }
}
