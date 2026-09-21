import { ROUTES, type Route, type RoutingDecision } from "./route";
import { InvalidProviderOutputError } from "./errors";

export function isRoute(value: unknown): value is Route {
  return typeof value === "string" && (ROUTES as readonly string[]).includes(value);
}

export function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Validates a provider-produced RoutingDecision before it enters the rest of
 * the system. Throws InvalidProviderOutputError on anything malformed, so
 * callers (HybridRouter, benchmark runner) can treat this as a technical
 * failure distinct from low confidence.
 */
export function assertValidRoutingDecision(decision: RoutingDecision): RoutingDecision {
  if (!isRoute(decision.route)) {
    throw new InvalidProviderOutputError(`invalid route: ${String(decision.route)}`, decision);
  }

  if (decision.confidence !== undefined && !isProbability(decision.confidence)) {
    throw new InvalidProviderOutputError(
      `invalid confidence: ${String(decision.confidence)}`,
      decision,
    );
  }

  if (decision.probabilities !== undefined) {
    for (const [route, probability] of Object.entries(decision.probabilities)) {
      if (!isRoute(route) || !isProbability(probability)) {
        throw new InvalidProviderOutputError(
          `invalid probability entry: ${route}=${String(probability)}`,
          decision,
        );
      }
    }
  }

  if (!Number.isFinite(decision.latencyMs) || decision.latencyMs < 0) {
    throw new InvalidProviderOutputError(
      `invalid latencyMs: ${String(decision.latencyMs)}`,
      decision,
    );
  }

  if (!decision.provider || !decision.model) {
    throw new InvalidProviderOutputError("missing provider or model on decision", decision);
  }

  return decision;
}
