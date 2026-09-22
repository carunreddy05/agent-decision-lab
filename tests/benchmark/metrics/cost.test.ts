import { describe, expect, it } from "vitest";
import { computeCostStats, computeHybridCostStats } from "@/benchmark/metrics/cost";
import type { HybridCaseResult } from "@/benchmark/result-types";

describe("computeCostStats", () => {
  it("keeps estimated and provider-reported cost as two separate totals", () => {
    const stats = computeCostStats([
      { estimatedCostUsd: 0.01, providerReportedCostUsd: 0.02 },
      { estimatedCostUsd: 0.03 },
    ]);
    expect(stats.totalEstimatedCostUsd).toBeCloseTo(0.04);
    expect(stats.totalProviderReportedCostUsd).toBeCloseTo(0.02);
    expect(stats.providerReportedCostSampleCount).toBe(1);
  });

  it("never infers a missing providerReportedCostUsd as $0/free", () => {
    const stats = computeCostStats([{ estimatedCostUsd: 0.01 }]);
    expect(stats.totalProviderReportedCostUsd).toBeUndefined();
    expect(stats.providerReportedCostSampleCount).toBe(0);
  });

  it("treats an explicit providerReportedCostUsd of 0 as a real reported value, not absence", () => {
    const stats = computeCostStats([{ estimatedCostUsd: 0.01, providerReportedCostUsd: 0 }]);
    expect(stats.totalProviderReportedCostUsd).toBe(0);
    expect(stats.providerReportedCostSampleCount).toBe(1);
  });
});

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

describe("computeHybridCostStats", () => {
  it("computes cost-per-fallback only from cases where the threshold actually escalated", () => {
    const results = [
      hybridResult({ jevEstimatedCostUsd: 0.001, fallbackTriggered: false }),
      hybridResult({ jevEstimatedCostUsd: 0.001, claudeEstimatedCostUsd: 0.01, fallbackTriggered: true, claudeCalled: true }),
    ];
    const stats = computeHybridCostStats(results);
    expect(stats.jevSubtotalEstimatedCostUsd).toBeCloseTo(0.002);
    expect(stats.claudeSubtotalEstimatedCostUsd).toBeCloseTo(0.01);
    expect(stats.fallbackCount).toBe(1);
    expect(stats.costPerFallbackUsd).toBeCloseTo(0.01);
  });

  it("reports costPerFallbackUsd as undefined when there was no fallback", () => {
    const stats = computeHybridCostStats([hybridResult({ jevEstimatedCostUsd: 0.001 })]);
    expect(stats.fallbackCount).toBe(0);
    expect(stats.costPerFallbackUsd).toBeUndefined();
  });
});
