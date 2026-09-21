import type { Action } from "./action";
import type { PolicyDecision } from "./policy";
import type { RoutingDecision } from "./route";

export type Strategy = "JEV_ONLY" | "CLAUDE_ONLY" | "HYBRID";

/**
 * Why (if at all) a hybrid run escalated to Claude. Kept as a tagged reason
 * rather than a boolean so a trace can distinguish the architecture choosing
 * to escalate (uncertainty) from the architecture having no choice
 * (technical failure) — see ADR-004.
 */
export type EscalationReason =
  | "NOT_APPLICABLE"
  | "CONFIDENCE_ABOVE_THRESHOLD"
  | "UNCERTAINTY_FALLBACK"
  | "TECHNICAL_FAILURE_FALLBACK";

export interface EscalationInfo {
  triggered: boolean;
  reason: EscalationReason;
  threshold?: number;
  detail?: string;
}

export interface ExecutionResult {
  tool: string;
  status: "success" | "skipped" | "error";
  detail?: string;
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
  action?: Action;
  policy?: PolicyDecision;
  execution?: ExecutionResult;
}
