import type { Action } from "@/domain/action";
import type { PolicyDecision } from "@/domain/policy";
import { POLICY_RULES } from "./policy-rules";

/**
 * The policy boundary. This function's signature is the architectural
 * guarantee: it takes an Action and nothing else, so a caller has no way to
 * pass in a confidence score, a model name, or "but the AI was really sure"
 * even by accident. See ADR-003.
 */
export function evaluatePolicy(action: Action): PolicyDecision {
  const rule = POLICY_RULES[action];
  return { action, result: rule.result, reason: rule.reason };
}
