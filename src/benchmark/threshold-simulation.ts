import type { Route } from "@/domain/route";
import { BENCHMARK_SCHEMA_VERSION, type ClaudeOnlyCaseResult, type JevOnlyCaseResult } from "./result-types";
import type { BenchmarkDifficulty } from "./types";

/**
 * OFFLINE THRESHOLD SIMULATION — reconstructs Hybrid decision behavior at
 * multiple confidence thresholds from independently-collected JEV_ONLY and
 * CLAUDE_ONLY case results, with ZERO additional provider calls (Phase 7A
 * design checkpoint §17/§18/§21; approved with refinements).
 *
 * Every artifact this module produces is tagged `analysisMode:
 * "OFFLINE_THRESHOLD_SIMULATION"` and every derived field is named with a
 * `simulated`/`jev`/`claude` prefix — never a bare Hybrid field name that
 * could be mistaken for a genuine live decideHybrid() run. In particular,
 * this module never computes a total/mean/p50/p95 "Hybrid latency" — real
 * orchestration overhead (see the Phase 6 smoke test's observed ~11ms gap
 * over the sum of provider latencies) cannot be reconstructed from two
 * independently-measured baseline latencies, so no latency field exists
 * here at all.
 *
 * A Jev *technical* failure in the JEV_ONLY baseline is a time-dependent
 * runtime observation — it does not prove the same failure would recur on a
 * genuine live Hybrid call, so such cases are marked
 * `NOT_RECONSTRUCTABLE_TECHNICAL_FAILURE` and excluded from the
 * reconstructable-case denominator, with their count reported separately.
 * This is different from a Claude baseline failure encountered *after* a
 * fallback decision was already made from Jev's own (successful, cached)
 * confidence: the fallback decision itself is still fully reconstructable
 * there, so that case stays in the reconstructable set and is simply scored
 * not-correct (the ordinary failed-case accuracy rule), same as a genuine
 * live Claude fallback that failed would be.
 */

export const DEFAULT_SIMULATION_THRESHOLDS: readonly number[] = [0.6, 0.7, 0.8, 0.9, 0.95];

export type SimulationStatus = "RECONSTRUCTED" | "NOT_RECONSTRUCTABLE_TECHNICAL_FAILURE";
export type SimulatedFallbackReason = "UNCERTAINTY_FALLBACK" | "MISSING_CONFIDENCE_FALLBACK";

export interface SimulatedHybridCaseResult {
  analysisMode: "OFFLINE_THRESHOLD_SIMULATION";
  benchmarkSchemaVersion: string;
  threshold: number;
  caseId: string;
  promptHash: string;
  expectedRoute: Route;
  difficulty: BenchmarkDifficulty;
  category: string;

  simulationStatus: SimulationStatus;

  jevSucceeded: boolean;
  jevErrorCategory?: string;
  jevRoute?: Route;
  jevConfidence?: number;
  jevCorrect?: boolean;

  simulatedFallbackTriggered?: boolean;
  simulatedFallbackReason?: SimulatedFallbackReason;
  simulatedClaudeCalled?: boolean;

  claudeSucceeded?: boolean;
  claudeRoute?: Route;
  claudeCorrect?: boolean;

  simulatedFinalRoute?: Route;
  simulatedFinalCorrect?: boolean;
  simulatedFinalProvider?: "jev" | "claude";

  simulatedEstimatedCostUsd?: number;

  agreedWithClaude?: boolean;
  claudeCorrectedJev?: boolean;
  claudeRegressedJev?: boolean;
}

export interface ThresholdAnalysisResult {
  analysisMode: "OFFLINE_THRESHOLD_SIMULATION";
  threshold: number;
  totalCases: number;
  reconstructableCases: number;
  nonReconstructableTechnicalFailureCount: number;
  simulatedFinalAccuracy: number;
  simulatedFallbackCount: number;
  simulatedFallbackRate: number;
  simulatedFallbackByReason: Record<SimulatedFallbackReason, number>;
  simulatedClaudeCallCount: number;
  correctJevEscalatedCount: number;
  incorrectJevEscalatedCount: number;
  incorrectJevNotEscalatedCount: number;
  claudeCorrectionsCount: number;
  claudeRegressionsCount: number;
  agreementCount: number;
  disagreementCount: number;
  simulatedEstimatedCostUsd: number;
  caseResults: SimulatedHybridCaseResult[];
}

function simulateCase(jev: JevOnlyCaseResult, claude: ClaudeOnlyCaseResult | undefined, threshold: number): SimulatedHybridCaseResult {
  const base = {
    analysisMode: "OFFLINE_THRESHOLD_SIMULATION" as const,
    benchmarkSchemaVersion: BENCHMARK_SCHEMA_VERSION,
    threshold,
    caseId: jev.caseId,
    promptHash: jev.promptHash,
    expectedRoute: jev.expectedRoute,
    difficulty: jev.difficulty,
    category: jev.category,
  };

  if (!jev.succeeded) {
    return {
      ...base,
      simulationStatus: "NOT_RECONSTRUCTABLE_TECHNICAL_FAILURE",
      jevSucceeded: false,
      jevErrorCategory: jev.errorCategory,
    };
  }

  const jevCorrect = jev.correctRoute === true;

  let fallbackTriggered: boolean;
  let fallbackReason: SimulatedFallbackReason | undefined;
  if (jev.confidence === undefined) {
    fallbackTriggered = true;
    fallbackReason = "MISSING_CONFIDENCE_FALLBACK";
  } else if (jev.confidence < threshold) {
    fallbackTriggered = true;
    fallbackReason = "UNCERTAINTY_FALLBACK";
  } else {
    fallbackTriggered = false;
  }

  const claudeSucceeded = claude?.succeeded === true;
  const claudeRoute = claudeSucceeded ? claude?.route : undefined;
  const claudeCorrect = claudeSucceeded ? claude?.correctRoute : undefined;

  const finalProvider: "jev" | "claude" = fallbackTriggered ? "claude" : "jev";
  const finalRoute = fallbackTriggered ? claudeRoute : jev.route;
  // A Claude baseline failure encountered after a valid (cached) fallback
  // decision is scored not-correct, same as any other failed-case accuracy
  // rule — it is not a reconstructability problem, since the decision of
  // *whether* to escalate was still fully determined by Jev's own cached,
  // successful confidence value.
  const finalCorrect = fallbackTriggered ? (claudeSucceeded ? claudeCorrect === true : false) : jevCorrect;

  const simulatedEstimatedCostUsd = (jev.estimatedCostUsd ?? 0) + (fallbackTriggered ? (claude?.estimatedCostUsd ?? 0) : 0);

  return {
    ...base,
    simulationStatus: "RECONSTRUCTED",
    jevSucceeded: true,
    jevRoute: jev.route,
    jevConfidence: jev.confidence,
    jevCorrect,
    simulatedFallbackTriggered: fallbackTriggered,
    simulatedFallbackReason: fallbackReason,
    simulatedClaudeCalled: fallbackTriggered,
    claudeSucceeded: fallbackTriggered ? claudeSucceeded : undefined,
    claudeRoute: fallbackTriggered ? claudeRoute : undefined,
    claudeCorrect: fallbackTriggered ? claudeCorrect : undefined,
    simulatedFinalRoute: finalRoute,
    simulatedFinalCorrect: finalCorrect,
    simulatedFinalProvider: finalProvider,
    simulatedEstimatedCostUsd,
    agreedWithClaude: fallbackTriggered && claudeSucceeded ? jev.route === claudeRoute : undefined,
    claudeCorrectedJev: fallbackTriggered && jevCorrect === false && finalCorrect === true,
    claudeRegressedJev: fallbackTriggered && jevCorrect === true && finalCorrect === false,
  };
}

/**
 * Pure function over two already-collected result sets — makes zero
 * provider calls (verified by tests asserting this module imports no
 * RouterProvider / provider adapter). Matches Jev and Claude results by
 * `caseId`; a Jev case with no matching Claude result behaves as if Claude
 * were unavailable for that case (scored not-correct if escalated, same as
 * any other failed-case rule).
 */
export function simulateThreshold(
  jevResults: readonly JevOnlyCaseResult[],
  claudeResults: readonly ClaudeOnlyCaseResult[],
  threshold: number,
): ThresholdAnalysisResult {
  const claudeById = new Map(claudeResults.map((c) => [c.caseId, c]));
  const caseResults = jevResults.map((jev) => simulateCase(jev, claudeById.get(jev.caseId), threshold));

  const reconstructable = caseResults.filter((c) => c.simulationStatus === "RECONSTRUCTED");
  const nonReconstructable = caseResults.filter((c) => c.simulationStatus === "NOT_RECONSTRUCTABLE_TECHNICAL_FAILURE");
  const fallbackCases = reconstructable.filter((c) => c.simulatedFallbackTriggered === true);
  const claudeCalledCases = reconstructable.filter((c) => c.simulatedClaudeCalled === true);
  const correctFinalCount = reconstructable.filter((c) => c.simulatedFinalCorrect === true).length;

  const simulatedFallbackByReason: Record<SimulatedFallbackReason, number> = {
    UNCERTAINTY_FALLBACK: fallbackCases.filter((c) => c.simulatedFallbackReason === "UNCERTAINTY_FALLBACK").length,
    MISSING_CONFIDENCE_FALLBACK: fallbackCases.filter((c) => c.simulatedFallbackReason === "MISSING_CONFIDENCE_FALLBACK").length,
  };

  return {
    analysisMode: "OFFLINE_THRESHOLD_SIMULATION",
    threshold,
    totalCases: caseResults.length,
    reconstructableCases: reconstructable.length,
    nonReconstructableTechnicalFailureCount: nonReconstructable.length,
    simulatedFinalAccuracy: reconstructable.length > 0 ? correctFinalCount / reconstructable.length : 0,
    simulatedFallbackCount: fallbackCases.length,
    simulatedFallbackRate: reconstructable.length > 0 ? fallbackCases.length / reconstructable.length : 0,
    simulatedFallbackByReason,
    simulatedClaudeCallCount: claudeCalledCases.length,
    correctJevEscalatedCount: fallbackCases.filter((c) => c.jevCorrect === true).length,
    incorrectJevEscalatedCount: fallbackCases.filter((c) => c.jevCorrect === false).length,
    incorrectJevNotEscalatedCount: reconstructable.filter((c) => c.simulatedFallbackTriggered === false && c.jevCorrect === false).length,
    claudeCorrectionsCount: claudeCalledCases.filter((c) => c.claudeCorrectedJev === true).length,
    claudeRegressionsCount: claudeCalledCases.filter((c) => c.claudeRegressedJev === true).length,
    agreementCount: claudeCalledCases.filter((c) => c.agreedWithClaude === true).length,
    disagreementCount: claudeCalledCases.filter((c) => c.agreedWithClaude === false).length,
    simulatedEstimatedCostUsd: reconstructable.reduce((sum, c) => sum + (c.simulatedEstimatedCostUsd ?? 0), 0),
    caseResults,
  };
}
