export interface LatencyStats {
  successfulLatencySampleCount: number;
  meanMs?: number;
  p50Ms?: number;
  p95Ms?: number;
  providerFailureCount: number;
  failedAttemptLatencySampleCount: number;
  failedAttemptLatencyMeanMs?: number;
}

export interface LatencySample {
  succeeded: boolean;
  latencyMs?: number;
}

function mean(values: readonly number[]): number | undefined {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : undefined;
}

function percentile(sortedValues: readonly number[], p: number): number | undefined {
  if (sortedValues.length === 0) return undefined;
  const index = Math.min(sortedValues.length - 1, Math.ceil(p * sortedValues.length) - 1);
  return sortedValues[Math.max(0, index)];
}

/**
 * Mean/p50/p95 use successful, completed decisions only — a failed
 * request's near-instant fail-fast (or absent) latency would skew "typical
 * successful call" stats. `providerFailureCount`/`failedAttemptLatency*` are
 * always reported alongside so the exclusion is visible, never silent
 * (Phase 7A design checkpoint §7/§9).
 */
export function computeLatencyStats(samples: readonly LatencySample[]): LatencyStats {
  const successful = samples
    .filter((s) => s.succeeded && s.latencyMs !== undefined)
    .map((s) => s.latencyMs as number)
    .sort((a, b) => a - b);
  const failedWithLatency = samples
    .filter((s) => !s.succeeded && s.latencyMs !== undefined)
    .map((s) => s.latencyMs as number);
  const providerFailureCount = samples.filter((s) => !s.succeeded).length;

  return {
    successfulLatencySampleCount: successful.length,
    meanMs: mean(successful),
    p50Ms: percentile(successful, 0.5),
    p95Ms: percentile(successful, 0.95),
    providerFailureCount,
    failedAttemptLatencySampleCount: failedWithLatency.length,
    failedAttemptLatencyMeanMs: mean(failedWithLatency),
  };
}
