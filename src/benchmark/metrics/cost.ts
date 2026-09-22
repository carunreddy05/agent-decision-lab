import type { HybridCaseResult } from "../result-types";

export interface CostStats {
  totalEstimatedCostUsd: number;
  meanEstimatedCostUsd?: number;
  /** Sum of only the defined provider-reported values; undefined when none were reported (never treated as $0 = free). */
  totalProviderReportedCostUsd?: number;
  providerReportedCostSampleCount: number;
}

export interface CostSample {
  estimatedCostUsd?: number;
  providerReportedCostUsd?: number;
}

/**
 * `estimatedCostUsd` (ours) and `providerReportedCostUsd` (the vendor's own
 * figure) are always kept as two separate numbers, never combined — a
 * missing or $0 providerReportedCostUsd is never read as "free" (Phase 7A
 * design checkpoint §10/CLAUDE.md fairness guardrails).
 */
export function computeCostStats(samples: readonly CostSample[]): CostStats {
  const estimated = samples.map((s) => s.estimatedCostUsd ?? 0);
  const totalEstimatedCostUsd = estimated.reduce((sum, v) => sum + v, 0);
  const reported = samples.filter((s) => s.providerReportedCostUsd !== undefined).map((s) => s.providerReportedCostUsd as number);

  return {
    totalEstimatedCostUsd,
    meanEstimatedCostUsd: samples.length > 0 ? totalEstimatedCostUsd / samples.length : undefined,
    totalProviderReportedCostUsd: reported.length > 0 ? reported.reduce((sum, v) => sum + v, 0) : undefined,
    providerReportedCostSampleCount: reported.length,
  };
}

export interface HybridCostStats {
  jevSubtotalEstimatedCostUsd: number;
  claudeSubtotalEstimatedCostUsd: number;
  totalEstimatedCostUsd: number;
  meanEstimatedCostUsdPerRequest?: number;
  fallbackCount: number;
  /** Marginal cost attributable to escalating: Claude subtotal / fallback count. Undefined when there was no fallback. */
  costPerFallbackUsd?: number;
}

export function computeHybridCostStats(results: readonly HybridCaseResult[]): HybridCostStats {
  const jevSubtotalEstimatedCostUsd = results.reduce((sum, r) => sum + (r.jevEstimatedCostUsd ?? 0), 0);
  const claudeSubtotalEstimatedCostUsd = results.reduce((sum, r) => sum + (r.claudeEstimatedCostUsd ?? 0), 0);
  const totalEstimatedCostUsd = jevSubtotalEstimatedCostUsd + claudeSubtotalEstimatedCostUsd;
  const fallbackCount = results.filter((r) => r.fallbackTriggered).length;

  return {
    jevSubtotalEstimatedCostUsd,
    claudeSubtotalEstimatedCostUsd,
    totalEstimatedCostUsd,
    meanEstimatedCostUsdPerRequest: results.length > 0 ? totalEstimatedCostUsd / results.length : undefined,
    fallbackCount,
    costPerFallbackUsd: fallbackCount > 0 ? claudeSubtotalEstimatedCostUsd / fallbackCount : undefined,
  };
}
