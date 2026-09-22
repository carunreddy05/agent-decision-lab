import { describe, expect, it } from "vitest";
import { computeLatencyStats } from "@/benchmark/metrics/latency";

describe("computeLatencyStats", () => {
  it("computes mean/p50/p95 from successful samples only", () => {
    const stats = computeLatencyStats([
      { succeeded: true, latencyMs: 100 },
      { succeeded: true, latencyMs: 200 },
      { succeeded: true, latencyMs: 300 },
    ]);
    expect(stats.successfulLatencySampleCount).toBe(3);
    expect(stats.meanMs).toBeCloseTo(200);
    expect(stats.p50Ms).toBe(200);
  });

  it("excludes failed cases from successful latency stats and reports them separately", () => {
    const stats = computeLatencyStats([
      { succeeded: true, latencyMs: 100 },
      { succeeded: false, latencyMs: 5 },
      { succeeded: false, latencyMs: 15 },
    ]);
    expect(stats.successfulLatencySampleCount).toBe(1);
    expect(stats.meanMs).toBe(100);
    expect(stats.providerFailureCount).toBe(2);
    expect(stats.failedAttemptLatencySampleCount).toBe(2);
    expect(stats.failedAttemptLatencyMeanMs).toBe(10);
  });

  it("returns undefined (not NaN) stats for an all-failed input", () => {
    const stats = computeLatencyStats([{ succeeded: false }]);
    expect(stats.meanMs).toBeUndefined();
    expect(stats.p50Ms).toBeUndefined();
    expect(stats.p95Ms).toBeUndefined();
    expect(stats.successfulLatencySampleCount).toBe(0);
  });

  it("never mixes a failed attempt's latency into the successful p95", () => {
    const stats = computeLatencyStats([
      { succeeded: true, latencyMs: 50 },
      { succeeded: false, latencyMs: 99999 },
    ]);
    expect(stats.p95Ms).toBe(50);
  });
});
