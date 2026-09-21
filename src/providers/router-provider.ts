import type { RoutingDecision, RoutingRequest } from "@/domain/route";

/**
 * The decision boundary. Every provider (Jev, Claude, Mock) implements this
 * and only this — nothing past a RoutingDecision is visible to a provider,
 * and a provider has no way to influence policy or execution.
 *
 * Implementations should throw ProviderTimeoutError / ProviderUnavailableError
 * for technical failures, and let assertValidRoutingDecision (domain/validate)
 * reject malformed output — callers rely on this to distinguish technical
 * failure from a validly low-confidence decision.
 */
export interface RouterProvider {
  readonly name: string;
  decide(request: RoutingRequest): Promise<RoutingDecision>;
}
