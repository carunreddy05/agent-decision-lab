import { describe, expect, it } from "vitest";
import { parseCliArgs, planDryRun } from "@/benchmark/cli";
import type { BenchmarkDataset } from "@/benchmark/types";

const DEFAULTS = { datasetPath: "/dataset.json", outputDir: "/out" };

function dataset(caseCount: number): BenchmarkDataset {
  return {
    version: "1.0",
    createdAt: "2026-01-01",
    description: "test",
    cases: Array.from({ length: caseCount }, (_, i) => ({
      id: `RC-${i}`,
      prompt: `prompt ${i}`,
      expectedRoute: "DOCS",
      difficulty: "CLEAR",
      category: "cat",
    })),
  };
}

describe("parseCliArgs", () => {
  it("requires --strategy", () => {
    const result = parseCliArgs([], DEFAULTS);
    expect(result.ok).toBe(false);
  });

  it("accepts jev/claude/hybrid/threshold-simulation but rejects mock", () => {
    expect(parseCliArgs(["--strategy", "jev"], DEFAULTS).ok).toBe(true);
    expect(parseCliArgs(["--strategy", "claude"], DEFAULTS).ok).toBe(true);
    expect(parseCliArgs(["--strategy", "hybrid"], DEFAULTS).ok).toBe(true);
    const mockResult = parseCliArgs(["--strategy", "mock"], DEFAULTS);
    expect(mockResult.ok).toBe(false);
  });

  it("defaults hybrid threshold to 0.8 when not given", () => {
    const result = parseCliArgs(["--strategy", "hybrid"], DEFAULTS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.threshold).toBe(0.8);
  });

  it("rejects --threshold for a non-hybrid strategy", () => {
    const result = parseCliArgs(["--strategy", "jev", "--threshold", "0.8"], DEFAULTS);
    expect(result.ok).toBe(false);
  });

  it("rejects an out-of-range threshold", () => {
    const result = parseCliArgs(["--strategy", "hybrid", "--threshold", "1.5"], DEFAULTS);
    expect(result.ok).toBe(false);
  });

  it("parses --limit as a positive integer and rejects invalid values", () => {
    const ok = parseCliArgs(["--strategy", "jev", "--limit", "5"], DEFAULTS);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.config.limit).toBe(5);

    expect(parseCliArgs(["--strategy", "jev", "--limit", "0"], DEFAULTS).ok).toBe(false);
    expect(parseCliArgs(["--strategy", "jev", "--limit", "abc"], DEFAULTS).ok).toBe(false);
  });

  it("requires --jev-run and --claude-run for threshold-simulation", () => {
    const missing = parseCliArgs(["--strategy", "threshold-simulation"], DEFAULTS);
    expect(missing.ok).toBe(false);

    const ok = parseCliArgs(
      ["--strategy", "threshold-simulation", "--jev-run", "/a", "--claude-run", "/b"],
      DEFAULTS,
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.config.thresholds).toEqual([0.6, 0.7, 0.8, 0.9, 0.95]);
  });

  it("parses an explicit --thresholds list for threshold-simulation", () => {
    const result = parseCliArgs(
      ["--strategy", "threshold-simulation", "--jev-run", "/a", "--claude-run", "/b", "--thresholds", "0.7,0.9"],
      DEFAULTS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.thresholds).toEqual([0.7, 0.9]);
  });

  describe("--pacing-ms", () => {
    it("defaults to 0 when omitted", () => {
      const result = parseCliArgs(["--strategy", "jev"], DEFAULTS);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.config.pacingMs).toBe(0);
    });

    it("accepts 0 explicitly", () => {
      const result = parseCliArgs(["--strategy", "jev", "--pacing-ms", "0"], DEFAULTS);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.config.pacingMs).toBe(0);
    });

    it("accepts a positive integer", () => {
      const result = parseCliArgs(["--strategy", "jev", "--pacing-ms", "2000"], DEFAULTS);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.config.pacingMs).toBe(2000);
    });

    it("rejects a negative value", () => {
      expect(parseCliArgs(["--strategy", "jev", "--pacing-ms", "-1"], DEFAULTS).ok).toBe(false);
      // The "=" form reaches our own validation (rather than node:util's
      // ambiguous-option error) and must also be rejected.
      expect(parseCliArgs(["--strategy", "jev", "--pacing-ms=-1"], DEFAULTS).ok).toBe(false);
    });

    it("rejects a non-numeric value", () => {
      expect(parseCliArgs(["--strategy", "jev", "--pacing-ms", "abc"], DEFAULTS).ok).toBe(false);
    });

    it("rejects a non-integer value", () => {
      expect(parseCliArgs(["--strategy", "jev", "--pacing-ms", "1.5"], DEFAULTS).ok).toBe(false);
    });

    it("rejects a missing value after the flag", () => {
      expect(parseCliArgs(["--strategy", "jev", "--pacing-ms"], DEFAULTS).ok).toBe(false);
    });
  });

  it("defaults dataset/output paths when not overridden", () => {
    const result = parseCliArgs(["--strategy", "jev"], DEFAULTS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.datasetPath).toBe(DEFAULTS.datasetPath);
      expect(result.config.outputDir).toBe(DEFAULTS.outputDir);
    }
  });
});

describe("planDryRun", () => {
  const git = { commit: "abc123", dirty: false };

  it("reports the full dataset case count and providers for a jev run with no limit", () => {
    const config = parseCliArgs(["--strategy", "jev", "--dry-run"], DEFAULTS);
    if (!config.ok) throw new Error("expected ok");
    const plan = planDryRun(config.config, dataset(100), "hash", git);

    expect(plan.dryRun).toBe(true);
    expect(plan.actualCaseCount).toBe(100);
    expect(plan.fullDataset).toBe(true);
    expect(plan.providersThatWouldBeCalled).toEqual(["jev"]);
    expect(plan.maxPossibleProviderCalls).toBe(100);
    expect(plan.pacingMs).toBe(0);
  });

  it("reports the configured pacingMs without ever sleeping", () => {
    const config = parseCliArgs(["--strategy", "jev", "--pacing-ms", "2000", "--dry-run"], DEFAULTS);
    if (!config.ok) throw new Error("expected ok");
    const start = Date.now();
    const plan = planDryRun(config.config, dataset(100), "hash", git);
    expect(plan.pacingMs).toBe(2000);
    expect(plan.actualCaseCount).toBe(100);
    expect(plan.providersThatWouldBeCalled).toEqual(["jev"]);
    expect(Date.now() - start).toBeLessThan(100);
  });

  it("marks fullDataset false and shrinks actualCaseCount when --limit is set", () => {
    const config = parseCliArgs(["--strategy", "claude", "--limit", "5", "--dry-run"], DEFAULTS);
    if (!config.ok) throw new Error("expected ok");
    const plan = planDryRun(config.config, dataset(100), "hash", git);

    expect(plan.actualCaseCount).toBe(5);
    expect(plan.fullDataset).toBe(false);
  });

  it("reports max possible Hybrid calls as 2x case count, never a predicted actual Claude-call count", () => {
    const config = parseCliArgs(["--strategy", "hybrid", "--dry-run"], DEFAULTS);
    if (!config.ok) throw new Error("expected ok");
    const plan = planDryRun(config.config, dataset(10), "hash", git);

    expect(plan.providersThatWouldBeCalled).toEqual(["jev", "claude"]);
    expect(plan.maxPossibleProviderCalls).toEqual({ jev: 10, claude: 10, total: 20 });
  });

  it("reports zero provider calls for threshold-simulation", () => {
    const config = parseCliArgs(
      ["--strategy", "threshold-simulation", "--jev-run", "/a", "--claude-run", "/b", "--dry-run"],
      DEFAULTS,
    );
    if (!config.ok) throw new Error("expected ok");
    const plan = planDryRun(config.config, dataset(10), "hash", git);

    expect(plan.providersThatWouldBeCalled).toEqual([]);
    expect(plan.maxPossibleProviderCalls).toBe(0);
  });

  it("includes pricing config version and git info", () => {
    const config = parseCliArgs(["--strategy", "jev", "--dry-run"], DEFAULTS);
    if (!config.ok) throw new Error("expected ok");
    const plan = planDryRun(config.config, dataset(10), "hash", { commit: "deadbeef", dirty: true });

    expect(plan.pricingConfigVersion).toBeTruthy();
    expect(plan.gitCommit).toBe("deadbeef");
    expect(plan.gitDirty).toBe(true);
  });
});
