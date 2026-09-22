import type { Action } from "./action";
import type { PolicyDecision } from "./policy";
import type { RoutingDecision } from "./route";

/**
 * MOCK is a Phase 1-2 development strategy — deterministic, network-free
 * routing used to build and test the pipeline before real providers exist.
 * It is never used to produce reported benchmark numbers (see ADR-005).
 */
export type Strategy = "MOCK" | "JEV_ONLY" | "CLAUDE_ONLY" | "HYBRID";

/**
 * Why (if at all) a hybrid run escalated to Claude. Kept as a tagged reason
 * rather than a boolean so a trace can distinguish the architecture choosing
 * to escalate (uncertainty) from the architecture having no choice
 * (technical failure) — see ADR-004.
 *
 * MISSING_CONFIDENCE_FALLBACK (Phase 6) is deliberately distinct from
 * UNCERTAINTY_FALLBACK: "Jev confidently reports low certainty" and "Jev
 * reports no certainty signal at all" are different architectural events.
 * Treating an absent confidence as if it were a known low value would be
 * exactly the "pretend confidence is zero" mistake this project has
 * consistently avoided — this is a strategy-level inability to evaluate the
 * decision against the threshold, not a measured low score.
 */
export type EscalationReason =
  | "NOT_APPLICABLE"
  | "CONFIDENCE_ABOVE_THRESHOLD"
  | "UNCERTAINTY_FALLBACK"
  | "MISSING_CONFIDENCE_FALLBACK"
  | "TECHNICAL_FAILURE_FALLBACK";

export interface EscalationInfo {
  triggered: boolean;
  reason: EscalationReason;
  threshold?: number;
  detail?: string;
}

/**
 * Hybrid-only aggregation/provenance that has no natural home on a single
 * RoutingDecision (Phase 6). Deliberately minimal — per-provider latency,
 * cost, and usage already live on `decision.jev`/`decision.claudeFallback`
 * (each a full RoutingDecision) and are never duplicated here.
 */
export interface HybridMeta {
  /**
   * Jev's error class name (e.g. "ProviderTimeoutError") — present only
   * when no Jev RoutingDecision exists at all (TECHNICAL_FAILURE_FALLBACK).
   * When Jev succeeded, its outcome is already on `decision.jev`.
   */
  initialErrorCategory?: string;
  /**
   * Jev's measured attempt latency — present only alongside
   * `initialErrorCategory`, since a thrown error carries no latency of its
   * own and `decision.jev` doesn't exist to hold `.latencyMs` in that case.
   */
  initialAttemptLatencyMs?: number;
  /**
   * Full Hybrid-strategy wall-clock. Not assumed to equal the sum of
   * provider latencies — orchestration overhead may exist.
   */
  totalLatencyMs: number;
  /** Sum of `estimatedCostUsd` across whichever provider(s) actually ran. */
  totalEstimatedCostUsd: number;
}

/** A single flat mock-tool result item (a doc, PR, or ticket) for display. */
export type ExecutionResultItem = Record<string, string | number>;

export interface ExecutionResult {
  tool: string;
  status: "success" | "skipped" | "error";
  detail?: string;
  results?: ExecutionResultItem[];
}

export interface Trace {
  traceId: string;
  createdAt: string;
  prompt: string;
  strategy: Strategy;
  decision: {
    jev?: RoutingDecision;
    claudeFallback?: RoutingDecision;
    final: RoutingDecision;
  };
  escalation: EscalationInfo;
  /** Only present for strategy === "HYBRID". */
  hybridMeta?: HybridMeta;
  action?: Action;
  policy?: PolicyDecision;
  execution?: ExecutionResult;
}
