import { describe, expect, it } from "vitest";
import { computeFallbackStats } from "@/benchmark/metrics/fallback";
import type { HybridCaseResult } from "@/benchmark/result-types";

function hybridResult(overrides: Partial<HybridCaseResult>): HybridCaseResult {
  return {
    benchmarkRunId: "r",
    benchmarkSchemaVersion: "benchmark-schema-v1",
    timestamp: "t",
    gitCommit: "g",
    datasetVersion: "1.0",
    datasetHash: "h",
    routingSpecVersion: "routing-spec-v1",
    caseId: "c",
    promptHash: "p",
    expectedRoute: "JIRA",
    difficulty: "CLEAR",
    category: "cat",
    succeeded: true,
    strategy: "HYBRID",
    threshold: 0.8,
    fallbackTriggered: false,
    claudeCalled: false,
    jevResolvedWithoutFallback: true,
    ...overrides,
  };
}

describe("computeFallbackStats", () => {
  it("counts fallbacks by reason without any success/failure judgment attached", () => {
    const stats = computeFallbackStats([
      hybridResult({ fallbackTriggered: false }),
      hybridResult({ fallbackTriggered: true, fallbackReason: "UNCERTAINTY_FALLBACK", claudeCalled: true }),
      hybridResult({ fallbackTriggered: true, fallbackReason: "MISSING_CONFIDENCE_FALLBACK", claudeCalled: true }),
      hybridResult({ fallbackTriggered: true, fallbackReason: "TECHNICAL_FAILURE_FALLBACK", claudeCalled: true }),
    ]);

    expect(stats.totalCases).toBe(4);
    expect(stats.fallbackCount).toBe(3);
    expect(stats.fallbackRate).toBeCloseTo(0.75);
    expect(stats.fallbackByReason).toEqual({
      UNCERTAINTY_FALLBACK: 1,
      MISSING_CONFIDENCE_FALLBACK: 1,
      TECHNICAL_FAILURE_FALLBACK: 1,
    });
    expect(stats.claudeCallCount).toBe(3);
  });

  it("returns 0 rate (not NaN) for an empty input", () => {
    const stats = computeFallbackStats([]);
    expect(stats.fallbackRate).toBe(0);
  });
});
