export type Route = "DIRECT_ANSWER" | "DOCS" | "GITHUB" | "JIRA" | "REJECT";

export const ROUTES: readonly Route[] = ["DIRECT_ANSWER", "DOCS", "GITHUB", "JIRA", "REJECT"];

export interface RoutingRequest {
  prompt: string;
}

export interface UsageMetadata {
  inputTokens?: number;
  outputTokens?: number;
  /** Our own after-the-fact estimate from a token count and a price assumption. */
  estimatedCostUsd?: number;
  /**
   * A dollar figure the provider itself reported for this request (e.g. an
   * AI-gateway's per-call cost field). Kept separate from `estimatedCostUsd`
   * on purpose — one is measured by the provider, the other is our guess,
   * and conflating them would misrepresent which is which in benchmark data.
   */
  providerReportedCostUsd?: number;
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
  /**
   * Which versioned routing instruction set produced this decision (e.g.
   * "routing-spec-v1"). Undefined for providers that don't take a spec (the
   * mock heuristic). Recorded here, not just in the spec source file, so a
   * benchmark artifact can say exactly what prompt version a given decision
   * ran under without cross-referencing run metadata.
   */
  routingSpecVersion?: string;
}
