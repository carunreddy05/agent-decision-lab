import { describe, expect, it } from "vitest";
import { buildManifest, buildRunId, getGitCommit, isGitDirty } from "@/benchmark/manifest";
import { PRICING_CONFIG_VERSION } from "@/benchmark/pricing-config";

describe("buildRunId", () => {
  it("produces a readable, sortable id: YYYYMMDD-HHmmss-<strategy>[-t<threshold*100>]", () => {
    const now = new Date(Date.UTC(2026, 8, 22, 11, 45, 0));
    expect(buildRunId("HYBRID", 0.8, now)).toBe("20260922-114500-hybrid-t080");
    expect(buildRunId("JEV_ONLY", undefined, now)).toBe("20260922-114500-jev-only");
  });
});

describe("getGitCommit / isGitDirty", () => {
  it("never throws even against a non-git directory", () => {
    expect(() => getGitCommit("/tmp")).not.toThrow();
    expect(() => isGitDirty("/tmp")).not.toThrow();
  });

  it("returns a real commit hash for this repository", () => {
    const commit = getGitCommit();
    expect(commit).toMatch(/^[0-9a-f]{40}$|^UNKNOWN$/);
  });
});

describe("buildManifest", () => {
  it("records no secrets — only git/dataset/config metadata", () => {
    const manifest = buildManifest({
      runId: "20260922-114500-jev-only",
      strategy: "JEV_ONLY",
      datasetVersion: "1.0",
      datasetHash: "abc123",
      routingSpecVersion: "routing-spec-v1",
      requestedCaseCount: 100,
      actualCaseCount: 100,
      fullDataset: true,
      dryRun: true,
      pacingMs: 0,
      now: new Date(Date.UTC(2026, 8, 22)),
      cwd: "/tmp",
    });

    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toMatch(/api[_-]?key/i);
    expect(serialized).not.toMatch(/sk-ant/i);
    expect(manifest.pricingConfigVersion).toBe(PRICING_CONFIG_VERSION);
    expect(manifest.requestedModelIdentifiers).toEqual({ jev: expect.any(String) });
    expect(manifest.fullDataset).toBe(true);
    expect(manifest.pacingMs).toBe(0);
  });

  it("includes threshold only for HYBRID", () => {
    const jevManifest = buildManifest({
      runId: "r1",
      strategy: "JEV_ONLY",
      datasetVersion: "1.0",
      datasetHash: "h",
      routingSpecVersion: "routing-spec-v1",
      requestedCaseCount: 5,
      actualCaseCount: 5,
      fullDataset: false,
      dryRun: true,
      pacingMs: 0,
    });
    expect(jevManifest.threshold).toBeUndefined();

    const hybridManifest = buildManifest({
      runId: "r2",
      strategy: "HYBRID",
      threshold: 0.9,
      datasetVersion: "1.0",
      datasetHash: "h",
      routingSpecVersion: "routing-spec-v1",
      requestedCaseCount: 5,
      actualCaseCount: 5,
      fullDataset: false,
      dryRun: true,
      pacingMs: 0,
    });
    expect(hybridManifest.threshold).toBe(0.9);
    expect(hybridManifest.requestedModelIdentifiers).toEqual({ jev: expect.any(String), claude: expect.any(String) });
  });

  it("marks a partial run's fullDataset as false", () => {
    const manifest = buildManifest({
      runId: "r3",
      strategy: "CLAUDE_ONLY",
      datasetVersion: "1.0",
      datasetHash: "h",
      requestedCaseCount: 5,
      actualCaseCount: 5,
      routingSpecVersion: "routing-spec-v1",
      fullDataset: false,
      dryRun: true,
      pacingMs: 0,
    });
    expect(manifest.fullDataset).toBe(false);
  });

  it("persists a positive pacingMs exactly as configured", () => {
    const manifest = buildManifest({
      runId: "r4",
      strategy: "JEV_ONLY",
      datasetVersion: "1.0",
      datasetHash: "h",
      routingSpecVersion: "routing-spec-v1",
      requestedCaseCount: 100,
      actualCaseCount: 100,
      fullDataset: true,
      dryRun: false,
      pacingMs: 2000,
    });
    expect(manifest.pacingMs).toBe(2000);
  });
});
