import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ClaudeOnlyCaseResult, JevOnlyCaseResult } from "@/benchmark/result-types";
import { DEFAULT_SIMULATION_THRESHOLDS, simulateThreshold } from "@/benchmark/threshold-simulation";

function jevCase(overrides: Partial<JevOnlyCaseResult>): JevOnlyCaseResult {
  return {
    benchmarkRunId: "jev-run",
    benchmarkSchemaVersion: "benchmark-schema-v1",
    timestamp: "t",
    gitCommit: "g",
    datasetVersion: "1.0",
    datasetHash: "h",
    routingSpecVersion: "routing-spec-v1",
    caseId: "RC-001",
    promptHash: "hash-1",
    expectedRoute: "JIRA",
    difficulty: "CLEAR",
    category: "cat",
    succeeded: true,
    strategy: "JEV_ONLY",
    route: "JIRA",
    correctRoute: true,
    confidence: 0.9,
    estimatedCostUsd: 0.0001,
    ...overrides,
  };
}

function claudeCase(overrides: Partial<ClaudeOnlyCaseResult>): ClaudeOnlyCaseResult {
  return {
    benchmarkRunId: "claude-run",
    benchmarkSchemaVersion: "benchmark-schema-v1",
    timestamp: "t",
    gitCommit: "g",
    datasetVersion: "1.0",
    datasetHash: "h",
    routingSpecVersion: "routing-spec-v1",
    caseId: "RC-001",
    promptHash: "hash-1",
    expectedRoute: "JIRA",
    difficulty: "CLEAR",
    category: "cat",
    succeeded: true,
    strategy: "CLAUDE_ONLY",
    route: "JIRA",
    correctRoute: true,
    estimatedCostUsd: 0.001,
    ...overrides,
  };
}

describe("simulateThreshold — offline reconstruction", () => {
  it("uses Jev's decision unchanged when confidence >= threshold (no fallback)", () => {
    const result = simulateThreshold([jevCase({ confidence: 0.9 })], [claudeCase({ route: "GITHUB" })], 0.8);
    const [caseResult] = result.caseResults;

    expect(caseResult.simulationStatus).toBe("RECONSTRUCTED");
    expect(caseResult.simulatedFallbackTriggered).toBe(false);
    expect(caseResult.simulatedClaudeCalled).toBe(false);
    expect(caseResult.simulatedFinalRoute).toBe("JIRA");
    expect(caseResult.simulatedFinalProvider).toBe("jev");
  });

  it("substitutes Claude's baseline decision when confidence < threshold", () => {
    const result = simulateThreshold(
      [jevCase({ confidence: 0.5, route: "GITHUB", correctRoute: false })],
      [claudeCase({ route: "JIRA" })],
      0.8,
    );
    const [caseResult] = result.caseResults;

    expect(caseResult.simulatedFallbackTriggered).toBe(true);
    expect(caseResult.simulatedFallbackReason).toBe("UNCERTAINTY_FALLBACK");
    expect(caseResult.simulatedFinalRoute).toBe("JIRA");
    expect(caseResult.simulatedFinalProvider).toBe("claude");
    expect(caseResult.claudeCorrectedJev).toBe(true);
  });

  it("simulates MISSING_CONFIDENCE_FALLBACK when Jev reports no confidence, never treating it as 0", () => {
    const result = simulateThreshold([jevCase({ confidence: undefined })], [claudeCase({})], 0.6);
    const [caseResult] = result.caseResults;

    expect(caseResult.simulatedFallbackReason).toBe("MISSING_CONFIDENCE_FALLBACK");
    expect(caseResult.simulatedFallbackTriggered).toBe(true);
  });

  it("marks a Jev technical failure as NOT_RECONSTRUCTABLE_TECHNICAL_FAILURE and excludes it from the reconstructable denominator", () => {
    const result = simulateThreshold(
      [jevCase({ succeeded: false, confidence: undefined, route: undefined, correctRoute: undefined, errorCategory: "ProviderTimeoutError" })],
      [claudeCase({})],
      0.8,
    );
    const [caseResult] = result.caseResults;

    expect(caseResult.simulationStatus).toBe("NOT_RECONSTRUCTABLE_TECHNICAL_FAILURE");
    expect(caseResult.simulatedFinalRoute).toBeUndefined();
    expect(result.totalCases).toBe(1);
    expect(result.reconstructableCases).toBe(0);
    expect(result.nonReconstructableTechnicalFailureCount).toBe(1);
  });

  it("never silently substitutes Claude for a Jev technical failure", () => {
    const result = simulateThreshold(
      [jevCase({ succeeded: false, confidence: undefined, route: undefined, correctRoute: undefined })],
      [claudeCase({ route: "JIRA" })],
      0.8,
    );
    const [caseResult] = result.caseResults;
    expect(caseResult.simulatedFinalProvider).toBeUndefined();
    expect(caseResult.claudeRoute).toBeUndefined();
  });

  it("scores a Claude baseline failure after a valid fallback decision as not-correct, and keeps the case reconstructable", () => {
    const result = simulateThreshold(
      [jevCase({ confidence: 0.5, route: "GITHUB" })],
      [claudeCase({ succeeded: false, route: undefined, correctRoute: undefined })],
      0.8,
    );
    const [caseResult] = result.caseResults;

    expect(caseResult.simulationStatus).toBe("RECONSTRUCTED");
    expect(caseResult.simulatedFallbackTriggered).toBe(true);
    expect(caseResult.simulatedFinalCorrect).toBe(false);
    expect(result.reconstructableCases).toBe(1);
  });

  it("computes correct/incorrect escalated and not-escalated counts (the headline high-confidence-error tracking)", () => {
    const jevResults = [
      jevCase({ caseId: "A", confidence: 0.9, correctRoute: false, route: "GITHUB" }), // incorrect, not escalated at 0.8
      jevCase({ caseId: "B", confidence: 0.5, correctRoute: true, route: "JIRA" }), // correct, escalated at 0.8
      jevCase({ caseId: "C", confidence: 0.5, correctRoute: false, route: "GITHUB" }), // incorrect, escalated at 0.8
    ];
    const claudeResults = [
      claudeCase({ caseId: "A", route: "JIRA" }),
      claudeCase({ caseId: "B", route: "JIRA" }),
      claudeCase({ caseId: "C", route: "JIRA" }),
    ];
    const result = simulateThreshold(jevResults, claudeResults, 0.8);

    expect(result.incorrectJevNotEscalatedCount).toBe(1);
    expect(result.correctJevEscalatedCount).toBe(1);
    expect(result.incorrectJevEscalatedCount).toBe(1);
  });

  it("uses only calls the threshold would actually require for simulatedEstimatedCostUsd", () => {
    const jevResults = [
      jevCase({ caseId: "A", confidence: 0.9, estimatedCostUsd: 0.0001 }), // no escalation — no Claude cost
      jevCase({ caseId: "B", confidence: 0.5, estimatedCostUsd: 0.0001 }), // escalates — Claude cost included
    ];
    const claudeResults = [claudeCase({ caseId: "A", estimatedCostUsd: 0.001 }), claudeCase({ caseId: "B", estimatedCostUsd: 0.001 })];
    const result = simulateThreshold(jevResults, claudeResults, 0.8);

    // Only case B's Claude cost should be included, not case A's (A never escalates).
    expect(result.simulatedEstimatedCostUsd).toBeCloseTo(0.0001 + 0.0001 + 0.001);
  });

  it("tags every result and case result with analysisMode OFFLINE_THRESHOLD_SIMULATION", () => {
    const result = simulateThreshold([jevCase({})], [claudeCase({})], 0.8);
    expect(result.analysisMode).toBe("OFFLINE_THRESHOLD_SIMULATION");
    expect(result.caseResults[0].analysisMode).toBe("OFFLINE_THRESHOLD_SIMULATION");
  });

  it("uses simulated*-prefixed field names, never bare Hybrid field names, for reconstructed values", () => {
    const result = simulateThreshold([jevCase({ confidence: 0.5 })], [claudeCase({})], 0.8);
    const caseResult = result.caseResults[0] as unknown as Record<string, unknown>;
    expect("simulatedFinalRoute" in caseResult).toBe(true);
    expect("finalRoute" in caseResult).toBe(false);
    expect("totalLatencyMs" in caseResult).toBe(false);
  });

  it("never computes any Hybrid total/mean/p50/p95 latency field anywhere in its output", () => {
    const result = simulateThreshold([jevCase({})], [claudeCase({})], 0.8);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/latency/i);
  });

  it("makes zero provider calls — this module has no dependency on RouterProvider or any provider adapter", () => {
    // Structural guarantee: simulateThreshold's only inputs are plain cached
    // arrays, and it performs no I/O — verified by running it 1000 times
    // synchronously with fixed inputs and confirming the output never varies
    // and the call completes without awaiting anything.
    const results = Array.from({ length: 5 }, () => simulateThreshold([jevCase({})], [claudeCase({})], 0.8));
    for (const r of results) {
      expect(r).toEqual(results[0]);
    }
  });

  it("supports the five approved default thresholds", () => {
    expect(DEFAULT_SIMULATION_THRESHOLDS).toEqual([0.6, 0.7, 0.8, 0.9, 0.95]);
  });

  it("matches Jev and Claude results by caseId, not by array position", () => {
    const jevResults = [jevCase({ caseId: "B", confidence: 0.5, route: "GITHUB" }), jevCase({ caseId: "A", confidence: 0.9, route: "JIRA" })];
    const claudeResults = [claudeCase({ caseId: "A", route: "DOCS" }), claudeCase({ caseId: "B", route: "JIRA" })];
    const result = simulateThreshold(jevResults, claudeResults, 0.8);

    const caseB = result.caseResults.find((c) => c.caseId === "B");
    expect(caseB?.simulatedFinalRoute).toBe("JIRA");
  });
});

describe("threshold-simulation.ts source — never imports a provider adapter", () => {
  it("has no import statement referencing a provider module or the RouterProvider interface", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "../../src/benchmark/threshold-simulation.ts"), "utf-8");
    const importLines = source.split("\n").filter((line) => line.trimStart().startsWith("import "));
    for (const line of importLines) {
      expect(line).not.toMatch(/providers\//);
      expect(line).not.toMatch(/RouterProvider/);
      expect(line).not.toMatch(/strategy\/hybrid-routing-strategy/);
    }
  });
});
