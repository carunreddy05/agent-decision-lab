import { describe, expect, it } from "vitest";
import { computeLayerAccuracy, computeRouteAccuracy } from "@/benchmark/metrics/accuracy";
import { buildConfusionMatrix } from "@/benchmark/metrics/confusion-matrix";
import { computeLatencyStats } from "@/benchmark/metrics/latency";
import { renderRunSummaryMarkdown, renderThresholdAnalysisMarkdown } from "@/benchmark/markdown-report";
import { BENCHMARK_LIMITATIONS } from "@/benchmark/limitations";
import type { RunManifest } from "@/benchmark/manifest";
import { simulateThreshold } from "@/benchmark/threshold-simulation";
import type { JevOnlyCaseResult, ClaudeOnlyCaseResult } from "@/benchmark/result-types";

function manifest(overrides: Partial<RunManifest> = {}): RunManifest {
  return {
    benchmarkSchemaVersion: "benchmark-schema-v1",
    runId: "20260922-114500-jev-only",
    timestamp: "2026-09-22T11:45:00.000Z",
    gitCommit: "deadbeef",
    gitDirty: false,
    datasetVersion: "1.0",
    datasetHash: "hash123",
    routingSpecVersion: "routing-spec-v1",
    strategy: "JEV_ONLY",
    requestedModelIdentifiers: { jev: "typesafe-ai/jev" },
    pricingConfigVersion: "pricing-v1-2026-09-22",
    requestedCaseCount: 100,
    actualCaseCount: 100,
    fullDataset: true,
    dryRun: false,
    nodeVersion: "v22.0.0",
    ...overrides,
  };
}

describe("renderRunSummaryMarkdown", () => {
  const routeAccuracy = computeRouteAccuracy([
    { expectedRoute: "JIRA", succeeded: true, correct: true, difficulty: "CLEAR", category: "cat" },
  ]);
  const layerAccuracy = computeLayerAccuracy([{ annotated: true, correct: true }]);
  const latency = computeLatencyStats([{ succeeded: true, latencyMs: 100 }]);
  const confusionMatrix = buildConfusionMatrix([{ expectedRoute: "JIRA", succeeded: true, observedRoute: "JIRA" }]);

  it("includes every required section", () => {
    const md = renderRunSummaryMarkdown({
      manifest: manifest(),
      routeAccuracy,
      actionAccuracy: layerAccuracy,
      policyAccuracy: layerAccuracy,
      latency,
      costLines: ["- Total (estimated): $0.001000"],
      usageLines: ["- 100 in / 10 out tokens (n=1)"],
      confusionMatrix,
      confusionMatrixTitle: "JEV_ONLY confusion matrix",
    });

    expect(md).toContain("Run metadata");
    expect(md).toContain("Routing accuracy");
    expect(md).toContain("Action-layer accuracy");
    expect(md).toContain("Policy-layer accuracy");
    expect(md).toContain("Latency");
    expect(md).toContain("Cost");
    expect(md).toContain("Usage");
    expect(md).toContain("JEV_ONLY confusion matrix");
    expect(md).toContain("Limitations");
    for (const limitation of BENCHMARK_LIMITATIONS) {
      expect(md).toContain(limitation);
    }
  });

  it("never generates a winner/best/promotional conclusion", () => {
    const md = renderRunSummaryMarkdown({
      manifest: manifest(),
      routeAccuracy,
      actionAccuracy: layerAccuracy,
      policyAccuracy: layerAccuracy,
      latency,
      costLines: [],
      usageLines: [],
      confusionMatrix,
      confusionMatrixTitle: "title",
    });
    expect(md.toLowerCase()).not.toMatch(/\bwinner\b|\bbest (provider|threshold)\b/);
  });

  it("shows a prominent partial-run banner when fullDataset is false", () => {
    const md = renderRunSummaryMarkdown({
      manifest: manifest({ fullDataset: false, actualCaseCount: 5, requestedCaseCount: 5 }),
      routeAccuracy,
      actionAccuracy: layerAccuracy,
      policyAccuracy: layerAccuracy,
      latency,
      costLines: [],
      usageLines: [],
      confusionMatrix,
      confusionMatrixTitle: "title",
    });
    expect(md).toContain("PARTIAL RUN");
  });

  it("does not show a partial-run banner for a full run", () => {
    const md = renderRunSummaryMarkdown({
      manifest: manifest({ fullDataset: true }),
      routeAccuracy,
      actionAccuracy: layerAccuracy,
      policyAccuracy: layerAccuracy,
      latency,
      costLines: [],
      usageLines: [],
      confusionMatrix,
      confusionMatrixTitle: "title",
    });
    expect(md).not.toContain("PARTIAL RUN");
  });
});

function jevCase(overrides: Partial<JevOnlyCaseResult>): JevOnlyCaseResult {
  return {
    benchmarkRunId: "r",
    benchmarkSchemaVersion: "benchmark-schema-v1",
    timestamp: "t",
    gitCommit: "g",
    datasetVersion: "1.0",
    datasetHash: "h",
    routingSpecVersion: "routing-spec-v1",
    caseId: "RC-1",
    promptHash: "hash",
    expectedRoute: "JIRA",
    difficulty: "CLEAR",
    category: "cat",
    succeeded: true,
    strategy: "JEV_ONLY",
    route: "JIRA",
    correctRoute: true,
    confidence: 0.9,
    ...overrides,
  };
}

function claudeCase(overrides: Partial<ClaudeOnlyCaseResult>): ClaudeOnlyCaseResult {
  return {
    benchmarkRunId: "r",
    benchmarkSchemaVersion: "benchmark-schema-v1",
    timestamp: "t",
    gitCommit: "g",
    datasetVersion: "1.0",
    datasetHash: "h",
    routingSpecVersion: "routing-spec-v1",
    caseId: "RC-1",
    promptHash: "hash",
    expectedRoute: "JIRA",
    difficulty: "CLEAR",
    category: "cat",
    succeeded: true,
    strategy: "CLAUDE_ONLY",
    route: "JIRA",
    correctRoute: true,
    ...overrides,
  };
}

describe("renderThresholdAnalysisMarkdown", () => {
  it("clearly labels the output as offline simulation, not a live Hybrid run", () => {
    const result = simulateThreshold([jevCase({})], [claudeCase({})], 0.8);
    const md = renderThresholdAnalysisMarkdown({
      datasetVersion: "1.0",
      datasetHash: "hash",
      routingSpecVersion: "routing-spec-v1",
      pricingConfigVersion: "pricing-v1-2026-09-22",
      gitCommit: "deadbeef",
      sourceJevRunId: "jev-run-1",
      sourceClaudeRunId: "claude-run-1",
      results: [result],
    });

    expect(md).toContain("OFFLINE_THRESHOLD_SIMULATION");
    expect(md).toContain("not a live Hybrid run");
    // The word "latency" may appear only in the explanatory disclaimer text
    // (e.g. "no ... Hybrid latency is reported here") — never as a reported
    // numeric metric in the tradeoff table's header or rows.
    expect(md).not.toMatch(/\|\s*(mean|p50|p95|total)?\s*latency/i);
  });

  it("never generates a winner/best-threshold conclusion", () => {
    const result = simulateThreshold([jevCase({})], [claudeCase({})], 0.8);
    const md = renderThresholdAnalysisMarkdown({
      datasetVersion: "1.0",
      datasetHash: "hash",
      routingSpecVersion: "routing-spec-v1",
      pricingConfigVersion: "pricing-v1-2026-09-22",
      gitCommit: "deadbeef",
      sourceJevRunId: "jev-run-1",
      sourceClaudeRunId: "claude-run-1",
      results: [result],
    });
    expect(md.toLowerCase()).not.toMatch(/\bwinner\b/);
    expect(md).toContain("No automatic ranking");
  });
});
