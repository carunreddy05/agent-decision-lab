import type { Action } from "@/domain/action";
import type { PolicyResult } from "@/domain/policy";
import type { Route } from "@/domain/route";
import type { EscalationReason } from "@/domain/trace";
import type { BenchmarkDifficulty } from "./types";

/**
 * Versions the case-result + manifest pair together, since they are always
 * produced and consumed as a set (Phase 7A design checkpoint §3/§4). A
 * breaking change to either schema bumps this, never edits history in place.
 */
export const BENCHMARK_SCHEMA_VERSION = "benchmark-schema-v1";

export type BenchmarkStrategy = "JEV_ONLY" | "CLAUDE_ONLY" | "HYBRID";

/**
 * Fields every case result carries regardless of strategy. `promptHash`
 * (not the raw prompt) is stored deliberately — see `prompt-hash.ts` — the
 * locked dataset remains the sole authoritative source for recovering
 * prompt text from a `caseId`.
 */
export interface CaseResultBase {
  benchmarkRunId: string;
  benchmarkSchemaVersion: string;
  timestamp: string;
  gitCommit: string;
  datasetVersion: string;
  datasetHash: string;
  routingSpecVersion: string;

  caseId: string;
  promptHash: string;
  expectedRoute: Route;
  expectedAction?: Action;
  expectedPolicy?: PolicyResult;
  difficulty: BenchmarkDifficulty;
  category: string;

  /**
   * A provider/strategy failure still produces a full row with this false —
   * never a dropped/missing case (Phase 7A design checkpoint §15).
   */
  succeeded: boolean;
  /** Safe error class name only (e.g. "ProviderTimeoutError"); present iff !succeeded. */
  errorCategory?: string;
  /**
   * The provider's own `Retry-After` value in milliseconds (Phase 8C-B),
   * propagated only when `errorCategory === "ProviderRateLimitError"` AND
   * the provider actually supplied it — never fabricated as 0 when absent,
   * never a raw header or response body. Observability only: nothing reads
   * this value to drive retry/backoff behavior.
   */
  retryAfterMs?: number;
}

export interface JevOnlyCaseResult extends CaseResultBase {
  strategy: "JEV_ONLY";
  route?: Route;
  correctRoute?: boolean;
  confidence?: number;
  probabilities?: Partial<Record<Route, number>>;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  providerReportedCostUsd?: number;
  requestedModelIdentifier?: string;
  resolvedModelIdentifier?: string | null;
  derivedAction?: Action;
  actionCorrect?: boolean;
  policyResult?: PolicyResult;
  policyCorrect?: boolean;
}

/**
 * Deliberately has no confidence/probabilities fields at all — structurally
 * absent, not merely optional-and-undefined, so "Claude has no such signal
 * in this integration" is visible in the type itself (Phase 7A §3).
 */
export interface ClaudeOnlyCaseResult extends CaseResultBase {
  strategy: "CLAUDE_ONLY";
  route?: Route;
  correctRoute?: boolean;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  providerReportedCostUsd?: number;
  requestedModelIdentifier?: string;
  resolvedModelIdentifier?: string | null;
  derivedAction?: Action;
  actionCorrect?: boolean;
  policyResult?: PolicyResult;
  policyCorrect?: boolean;
}

export interface HybridCaseResult extends CaseResultBase {
  strategy: "HYBRID";
  threshold: number;

  initialJevRoute?: Route;
  initialJevCorrect?: boolean;
  initialJevConfidence?: number;
  initialJevProbabilities?: Partial<Record<Route, number>>;
  jevLatencyMs?: number;
  jevInputTokens?: number;
  jevOutputTokens?: number;
  jevEstimatedCostUsd?: number;
  jevProviderReportedCostUsd?: number;
  initialErrorCategory?: string;

  fallbackTriggered: boolean;
  fallbackReason?: EscalationReason;

  claudeCalled: boolean;
  claudeRoute?: Route;
  claudeCorrect?: boolean;
  claudeLatencyMs?: number;
  claudeInputTokens?: number;
  claudeOutputTokens?: number;
  claudeEstimatedCostUsd?: number;
  claudeProviderReportedCostUsd?: number;

  finalRoute?: Route;
  finalCorrect?: boolean;
  finalProvider?: "jev" | "claude";
  /** Only meaningful for a genuine live decideHybrid() run — never fabricated by offline simulation. */
  totalLatencyMs?: number;
  totalEstimatedCostUsd?: number;

  /** Factual, computed booleans only — no evaluative "good/bad fallback" labels (Phase 7A §4). */
  jevResolvedWithoutFallback: boolean;
  agreedWithClaude?: boolean;
  claudeCorrectedJev?: boolean;
  claudeRegressedJev?: boolean;

  derivedAction?: Action;
  actionCorrect?: boolean;
  policyResult?: PolicyResult;
  policyCorrect?: boolean;
}

export type CaseResult = JevOnlyCaseResult | ClaudeOnlyCaseResult | HybridCaseResult;
