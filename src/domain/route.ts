export type Route = "DIRECT_ANSWER" | "DOCS" | "GITHUB" | "JIRA" | "REJECT";

export const ROUTES: readonly Route[] = ["DIRECT_ANSWER", "DOCS", "GITHUB", "JIRA", "REJECT"];

export interface RoutingRequest {
  prompt: string;
}

export interface UsageMetadata {
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
}

/** Provider-reported metadata that is safe to log/display (no secrets, no raw provider payloads). */
export type SafeMetadata = Record<string, string | number | boolean | null>;

/**
 * A single provider's routing output, normalized into the shared domain shape.
 *
 * `confidence` and `probabilities` are provider-reported scores, not measured
 * probabilities of correctness. Do not treat them as calibrated unless a
 * calibration study has actually been run — see ADR-004.
 */
export interface RoutingDecision {
  route: Route;
  provider: string;
  model: string;
  confidence?: number;
  probabilities?: Partial<Record<Route, number>>;
  latencyMs: number;
  usage?: UsageMetadata;
  rawMetadata?: SafeMetadata;
}
