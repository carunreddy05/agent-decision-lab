import { describe, expect, it } from "vitest";
import { computeLayerAccuracy, computeRouteAccuracy } from "@/benchmark/metrics/accuracy";

describe("computeRouteAccuracy", () => {
  it("counts a failed case as not-correct in every denominator, and reports failures separately", () => {
    const results = computeRouteAccuracy([
      { expectedRoute: "JIRA", succeeded: true, correct: true, difficulty: "CLEAR", category: "c1" },
      { expectedRoute: "JIRA", succeeded: true, correct: false, difficulty: "CLEAR", category: "c1" },
      { expectedRoute: "JIRA", succeeded: false, difficulty: "CLEAR", category: "c1" },
    ]);

    expect(results.overall.total).toBe(3);
    expect(results.overall.correct).toBe(1);
    expect(results.overall.accuracy).toBeCloseTo(1 / 3);
    expect(results.failureCount).toBe(1);
    expect(results.failureRate).toBeCloseTo(1 / 3);
  });

  it("breaks down by route, difficulty, and category independently", () => {
    const results = computeRouteAccuracy([
      { expectedRoute: "DOCS", succeeded: true, correct: true, difficulty: "CLEAR", category: "docs-basic" },
      { expectedRoute: "GITHUB", succeeded: true, correct: false, difficulty: "MODERATE", category: "github-pr" },
    ]);

    expect(results.byRoute.DOCS).toEqual({ total: 1, correct: 1, accuracy: 1 });
    expect(results.byRoute.GITHUB).toEqual({ total: 1, correct: 0, accuracy: 0 });
    expect(results.byDifficulty.CLEAR.total).toBe(1);
    expect(results.byDifficulty.MODERATE.total).toBe(1);
    expect(results.byCategory["docs-basic"]).toEqual({ total: 1, correct: 1, accuracy: 1 });
    expect(results.byCategory["github-pr"]).toEqual({ total: 1, correct: 0, accuracy: 0 });
  });

  it("includes every route in byRoute even with zero cases for it", () => {
    const results = computeRouteAccuracy([{ expectedRoute: "DOCS", succeeded: true, correct: true, difficulty: "CLEAR", category: "x" }]);
    expect(results.byRoute.REJECT).toEqual({ total: 0, correct: 0, accuracy: 0 });
  });

  it("returns 0 accuracy (not NaN) for an empty input", () => {
    const results = computeRouteAccuracy([]);
    expect(results.overall.accuracy).toBe(0);
    expect(results.failureRate).toBe(0);
  });
});

describe("computeLayerAccuracy", () => {
  it("computes accuracy only over annotated cases", () => {
    const summary = computeLayerAccuracy([
      { annotated: true, correct: true },
      { annotated: true, correct: false },
      { annotated: false, correct: undefined },
    ]);
    expect(summary.annotatedCount).toBe(2);
    expect(summary.correctCount).toBe(1);
    expect(summary.accuracy).toBe(0.5);
  });

  it("returns 0 accuracy (not NaN) when nothing is annotated", () => {
    const summary = computeLayerAccuracy([{ annotated: false, correct: undefined }]);
    expect(summary.annotatedCount).toBe(0);
    expect(summary.accuracy).toBe(0);
  });
});
