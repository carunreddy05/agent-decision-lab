import { execFileSync } from "node:child_process";
import { CLAUDE_MODEL_ID } from "@/providers/claude/config";
import { JEV_MODEL_ID } from "@/providers/jev/config";
import { PRICING_CONFIG_VERSION } from "./pricing-config";
import { BENCHMARK_SCHEMA_VERSION, type BenchmarkStrategy } from "./result-types";

export { BENCHMARK_SCHEMA_VERSION };

/**
 * Full reproducibility record for one benchmark run (Phase 7A design
 * checkpoint §4/§16/§18). No secrets: every field is derived from git/
 * dataset/config metadata, never from an environment variable's value.
 */
export interface RunManifest {
  benchmarkSchemaVersion: string;
  runId: string;
  timestamp: string;
  gitCommit: string;
  gitDirty: boolean;
  datasetVersion: string;
  datasetHash: string;
  routingSpecVersion: string;
  strategy: BenchmarkStrategy;
  threshold?: number;
  requestedModelIdentifiers: { jev?: string; claude?: string };
  pricingConfigVersion: string;
  requestedCaseCount: number;
  actualCaseCount: number;
  fullDataset: boolean;
  dryRun: boolean;
  nodeVersion: string;
  /**
   * Fixed, non-adaptive delay (ms) the outer benchmark loop waited between
   * cases (Phase 8C-B) — 0 when pacing wasn't requested, the exact
   * configured value otherwise. This is benchmark execution configuration,
   * never a provider property: it is never included in any
   * `latencyMs` figure, which continues to measure only the provider call
   * itself. Added additively to `benchmark-schema-v1` (no version bump —
   * nothing parses/validates historical artifacts against this schema's
   * shape, so an old manifest simply predates this field rather than being
   * invalidated by it).
   */
  pacingMs: number;
}

/** Never throws — an unavailable git binary/repo degrades to "UNKNOWN", not a crashed run. */
export function getGitCommit(cwd: string = process.cwd()): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "UNKNOWN";
  }
}

/** Never throws — see getGitCommit. Defaults to "not dirty" only on a genuine git failure, never silently on real uncommitted changes. */
export function isGitDirty(cwd: string = process.cwd()): boolean {
  try {
    const output = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Human-scannable, sortable run identifier: `YYYYMMDD-HHmmss-<strategy>[-t<threshold*100>]`,
 * e.g. `20260922-114500-hybrid-t080` (Phase 7A design checkpoint §9/§19).
 */
export function buildRunId(strategy: string, threshold: number | undefined, now: Date = new Date()): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  const datePart = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const timePart = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const strategyPart = strategy.toLowerCase().replace(/_/g, "-");
  const thresholdPart = threshold !== undefined ? `-t${pad(Math.round(threshold * 100), 3)}` : "";
  return `${datePart}-${timePart}-${strategyPart}${thresholdPart}`;
}

function requestedModelIdentifiersFor(strategy: BenchmarkStrategy): { jev?: string; claude?: string } {
  switch (strategy) {
    case "JEV_ONLY":
      return { jev: JEV_MODEL_ID };
    case "CLAUDE_ONLY":
      return { claude: CLAUDE_MODEL_ID };
    case "HYBRID":
      return { jev: JEV_MODEL_ID, claude: CLAUDE_MODEL_ID };
  }
}

export function buildManifest(params: {
  runId: string;
  strategy: BenchmarkStrategy;
  threshold?: number;
  datasetVersion: string;
  datasetHash: string;
  routingSpecVersion: string;
  requestedCaseCount: number;
  actualCaseCount: number;
  fullDataset: boolean;
  dryRun: boolean;
  pacingMs: number;
  now?: Date;
  cwd?: string;
}): RunManifest {
  return {
    benchmarkSchemaVersion: BENCHMARK_SCHEMA_VERSION,
    runId: params.runId,
    timestamp: (params.now ?? new Date()).toISOString(),
    gitCommit: getGitCommit(params.cwd),
    gitDirty: isGitDirty(params.cwd),
    datasetVersion: params.datasetVersion,
    datasetHash: params.datasetHash,
    routingSpecVersion: params.routingSpecVersion,
    strategy: params.strategy,
    ...(params.threshold !== undefined ? { threshold: params.threshold } : {}),
    requestedModelIdentifiers: requestedModelIdentifiersFor(params.strategy),
    pricingConfigVersion: PRICING_CONFIG_VERSION,
    requestedCaseCount: params.requestedCaseCount,
    actualCaseCount: params.actualCaseCount,
    fullDataset: params.fullDataset,
    dryRun: params.dryRun,
    nodeVersion: process.version,
    pacingMs: params.pacingMs,
  };
}
