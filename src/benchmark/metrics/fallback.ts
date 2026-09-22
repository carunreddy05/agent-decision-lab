import type { EscalationReason } from "@/domain/trace";
import type { HybridCaseResult } from "../result-types";

export interface FallbackStats {
  totalCases: number;
  fallbackCount: number;
  fallbackRate: number;
  fallbackByReason: Partial<Record<EscalationReason, number>>;
  claudeCallCount: number;
}

/** Pure counts/rates — no success/failure judgment attached to the fallback event itself (Phase 7A §12). */
export function computeFallbackStats(results: readonly HybridCaseResult[]): FallbackStats {
  const fallbackCases = results.filter((r) => r.fallbackTriggered);
  const fallbackByReason: Partial<Record<EscalationReason, number>> = {};
  for (const r of fallbackCases) {
    if (r.fallbackReason) {
      fallbackByReason[r.fallbackReason] = (fallbackByReason[r.fallbackReason] ?? 0) + 1;
    }
  }

  return {
    totalCases: results.length,
    fallbackCount: fallbackCases.length,
    fallbackRate: results.length > 0 ? fallbackCases.length / results.length : 0,
    fallbackByReason,
    claudeCallCount: results.filter((r) => r.claudeCalled).length,
  };
}
