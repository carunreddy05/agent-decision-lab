import { assertValidRoutingDecision } from "@/domain/validate";
import type { RoutingDecision } from "@/domain/route";
import type { EscalationInfo, HybridMeta, Strategy, Trace } from "@/domain/trace";
import { evaluatePolicy } from "@/policy/policy-engine";
import { MockRouterProvider } from "@/providers/mock/mock-provider";
import type { RouterProvider } from "@/providers/router-provider";
import { decideHybrid, DEFAULT_CONFIDENCE_THRESHOLD, type HybridRoutingOptions } from "@/strategy/hybrid-routing-strategy";
import { deriveAction } from "./derive-action";
import { executeAllowedAction, TOOL_NAMES } from "./execute-action";

export { DEFAULT_CONFIDENCE_THRESHOLD };

export interface RunDecisionOptions {
  /** Injectable for tests and for future provider swaps; defaults to the mock provider. Ignored when `hybrid` is set. */
  provider?: RouterProvider;
  confidenceThreshold?: number;
  /**
   * Opt into the Hybrid strategy (Jev first, Claude on fallback) instead of
   * a single provider. `true` uses real Jev/Claude providers; pass an
   * object to inject stub providers for tests.
   */
  hybrid?: boolean | HybridRoutingOptions;
}

/**
 * The application/orchestration layer: request -> router decision -> decision
 * validation -> route/action mapping -> policy evaluation -> tool execution
 * (if ALLOW) -> structured trace. This is the only place these boundaries
 * are wired together — UI components and the API route call this function
 * and render its result; they never talk to a provider, the policy engine,
 * a tool, or the Hybrid strategy directly.
 *
 * Throws (does not catch) ProviderTimeoutError / ProviderUnavailableError /
 * InvalidProviderOutputError / the other Provider* errors, and
 * HybridFallbackFailedError, from the provider/strategy layer — those are
 * technical failures, distinct from a low-confidence decision, and the
 * caller (API route) is responsible for turning them into a visible error
 * response rather than a fabricated trace. See ADR-004.
 */
export async function runDecision(prompt: string, options: RunDecisionOptions = {}): Promise<Trace> {
  const threshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

  let strategy: Strategy;
  let decisionSlice: Trace["decision"];
  let escalation: EscalationInfo;
  let hybridMeta: HybridMeta | undefined;
  let finalDecision: RoutingDecision;

  if (options.hybrid) {
    const hybridOptions = typeof options.hybrid === "object" ? options.hybrid : {};
    const result = await decideHybrid(
      { prompt },
      { ...hybridOptions, confidenceThreshold: hybridOptions.confidenceThreshold ?? threshold },
    );
    strategy = "HYBRID";
    finalDecision = result.finalDecision;
    decisionSlice = { jev: result.initialDecision, claudeFallback: result.claudeDecision, final: finalDecision };
    escalation = result.escalation;
    hybridMeta = result.hybridMeta;
  } else {
    const provider = options.provider ?? new MockRouterProvider();
    finalDecision = assertValidRoutingDecision(await provider.decide({ prompt }));
    strategy = strategyForProvider(provider);
    decisionSlice = { final: finalDecision };
    escalation = evaluateEscalation(finalDecision, threshold);
  }

  const derived = deriveAction(finalDecision.route, prompt);
  const policy = derived.action ? evaluatePolicy(derived.action) : undefined;

  const execution = policy
    ? policy.result === "ALLOW"
      ? executeAllowedAction(derived)
      : {
          tool: derived.action ? TOOL_NAMES[derived.action] : "none",
          status: "skipped" as const,
          detail:
            policy.result === "DENY"
              ? "Execution blocked by application policy."
              : "Execution paused. Human approval would be required.",
        }
    : {
        tool: "none",
        status: (finalDecision.route === "REJECT" ? "skipped" : "success") as "skipped" | "success",
        detail: derived.reason,
      };

  return {
    traceId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    prompt,
    strategy,
    decision: decisionSlice,
    escalation,
    ...(hybridMeta ? { hybridMeta } : {}),
    action: derived.action ?? undefined,
    policy,
    execution,
  };
}

/**
 * Pre-existing bug fixed in Phase 6: this previously hardcoded "MOCK"
 * regardless of which provider actually ran, mislabeling every Jev-only and
 * Claude-only trace since Phase 4/5. Hybrid can't self-report correctly
 * without this fix, so it's bundled in here rather than left for later.
 */
function strategyForProvider(provider: RouterProvider): Strategy {
  switch (provider.name) {
    case "jev":
      return "JEV_ONLY";
    case "claude":
      return "CLAUDE_ONLY";
    default:
      return "MOCK";
  }
}

function evaluateEscalation(decision: RoutingDecision, threshold: number): EscalationInfo {
  if (decision.confidence === undefined) {
    return {
      triggered: false,
      reason: "NOT_APPLICABLE",
      threshold,
      detail: "Provider does not report a confidence score.",
    };
  }

  if (decision.confidence < threshold) {
    return {
      triggered: false,
      reason: "UNCERTAINTY_FALLBACK",
      threshold,
      detail:
        "Below threshold — would escalate to a general-purpose LLM under the hybrid architecture. This run used a single provider directly, so no escalation actually occurred.",
    };
  }

  return {
    triggered: false,
    reason: "CONFIDENCE_ABOVE_THRESHOLD",
    threshold,
    detail: "At or above threshold — would not escalate.",
  };
}
