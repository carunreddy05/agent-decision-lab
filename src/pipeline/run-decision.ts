import { assertValidRoutingDecision } from "@/domain/validate";
import type { RoutingDecision } from "@/domain/route";
import type { EscalationInfo, Trace } from "@/domain/trace";
import { evaluatePolicy } from "@/policy/policy-engine";
import { MockRouterProvider } from "@/providers/mock/mock-provider";
import type { RouterProvider } from "@/providers/router-provider";
import { deriveAction } from "./derive-action";
import { executeAllowedAction, TOOL_NAMES } from "./execute-action";

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

export interface RunDecisionOptions {
  /** Injectable for tests and for future provider swaps; defaults to the mock provider. */
  provider?: RouterProvider;
  confidenceThreshold?: number;
}

/**
 * The application/orchestration layer: request -> router decision -> decision
 * validation -> route/action mapping -> policy evaluation -> tool execution
 * (if ALLOW) -> structured trace. This is the only place these boundaries
 * are wired together — UI components and the API route call this function
 * and render its result; they never talk to a provider, the policy engine,
 * or a tool directly.
 *
 * Throws (does not catch) ProviderTimeoutError / ProviderUnavailableError /
 * InvalidProviderOutputError from the provider layer — those are technical
 * failures, distinct from a low-confidence decision, and the caller (API
 * route) is responsible for turning them into a visible error response
 * rather than a fabricated trace. See ADR-004.
 */
export async function runDecision(prompt: string, options: RunDecisionOptions = {}): Promise<Trace> {
  const provider = options.provider ?? new MockRouterProvider();
  const threshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

  const rawDecision = await provider.decide({ prompt });
  const decision = assertValidRoutingDecision(rawDecision);

  const escalation = evaluateEscalation(decision, threshold);
  const derived = deriveAction(decision.route, prompt);
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
        status: (decision.route === "REJECT" ? "skipped" : "success") as "skipped" | "success",
        detail: derived.reason,
      };

  return {
    traceId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    prompt,
    strategy: "MOCK",
    decision: { final: decision },
    escalation,
    action: derived.action ?? undefined,
    policy,
    execution,
  };
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
        "Below threshold — would escalate to a general-purpose LLM under the hybrid architecture (Phase 6, not implemented yet).",
    };
  }

  return {
    triggered: false,
    reason: "CONFIDENCE_ABOVE_THRESHOLD",
    threshold,
    detail: "At or above threshold — would not escalate.",
  };
}
