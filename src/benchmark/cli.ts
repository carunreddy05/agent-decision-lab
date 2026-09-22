import { parseArgs } from "node:util";
import { PRICING_CONFIG_VERSION } from "./pricing-config";
import { DEFAULT_SIMULATION_THRESHOLDS } from "./threshold-simulation";
import type { BenchmarkDataset } from "./types";

/**
 * CLI for `scripts/benchmark-runner.ts`. Parsed with Node's built-in
 * `node:util.parseArgs` — no new dependency (Phase 7A design checkpoint
 * §25). `mock` is deliberately not an accepted `--strategy` value: Mock is
 * not a real comparison provider (CLAUDE.md / phase3-baseline.ts remains
 * its only entry point).
 */
export type CliStrategy = "jev" | "claude" | "hybrid" | "threshold-simulation";

const HYBRID_DEFAULT_THRESHOLD = 0.8;

export interface CliConfig {
  strategy: CliStrategy;
  threshold?: number;
  thresholds?: number[];
  limit?: number;
  dryRun: boolean;
  jevRunDir?: string;
  claudeRunDir?: string;
  datasetPath: string;
  outputDir: string;
  /**
   * Fixed, non-adaptive delay (ms) the outer benchmark loop waits between
   * cases (Phase 8C-B) — never inside a provider adapter, never based on
   * the previous case's latency/status/correctness. Always present and
   * always 0 unless `--pacing-ms` was passed, so a run's provenance always
   * states its pacing explicitly rather than leaving it implicit.
   */
  pacingMs: number;
}

export type ParsedCliArgs = { ok: true; config: CliConfig } | { ok: false; error: string };

export interface CliDefaults {
  datasetPath: string;
  outputDir: string;
}

function parseNumberOption(value: string | undefined, name: string): { ok: true; value: number | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: `--${name} must be a number (got "${value}").` };
  }
  return { ok: true, value: parsed };
}

export function parseCliArgs(argv: readonly string[], defaults: CliDefaults): ParsedCliArgs {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        strategy: { type: "string" },
        threshold: { type: "string" },
        thresholds: { type: "string" },
        limit: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        "jev-run": { type: "string" },
        "claude-run": { type: "string" },
        dataset: { type: "string" },
        out: { type: "string" },
        "pacing-ms": { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const strategyRaw = values.strategy;
  if (typeof strategyRaw !== "string" || !isCliStrategy(strategyRaw)) {
    return {
      ok: false,
      error: `--strategy is required and must be one of jev, claude, hybrid, threshold-simulation (got ${JSON.stringify(strategyRaw)}).`,
    };
  }
  const strategy = strategyRaw;

  const thresholdParsed = parseNumberOption(values.threshold as string | undefined, "threshold");
  if (!thresholdParsed.ok) return thresholdParsed;
  if (thresholdParsed.value !== undefined && (thresholdParsed.value < 0 || thresholdParsed.value > 1)) {
    return { ok: false, error: `--threshold must be between 0 and 1 (got ${thresholdParsed.value}).` };
  }
  if (strategy !== "hybrid" && thresholdParsed.value !== undefined) {
    return { ok: false, error: "--threshold is only valid with --strategy hybrid." };
  }

  let thresholds: number[] | undefined;
  const thresholdsRaw = values.thresholds as string | undefined;
  if (thresholdsRaw !== undefined) {
    if (strategy !== "threshold-simulation") {
      return { ok: false, error: "--thresholds is only valid with --strategy threshold-simulation." };
    }
    thresholds = thresholdsRaw.split(",").map((part) => Number(part.trim()));
    for (const t of thresholds) {
      if (!Number.isFinite(t) || t < 0 || t > 1) {
        return { ok: false, error: `--thresholds must be a comma-separated list of numbers between 0 and 1 (got "${thresholdsRaw}").` };
      }
    }
  } else if (strategy === "threshold-simulation") {
    thresholds = [...DEFAULT_SIMULATION_THRESHOLDS];
  }

  const limitParsed = parseNumberOption(values.limit as string | undefined, "limit");
  if (!limitParsed.ok) return limitParsed;
  if (limitParsed.value !== undefined && (!Number.isInteger(limitParsed.value) || limitParsed.value <= 0)) {
    return { ok: false, error: `--limit must be a positive integer (got ${limitParsed.value}).` };
  }

  if (strategy === "threshold-simulation") {
    if (typeof values["jev-run"] !== "string" || typeof values["claude-run"] !== "string") {
      return { ok: false, error: "--strategy threshold-simulation requires both --jev-run and --claude-run." };
    }
  }

  // Deliberately a strict "digits only" check, not Number()/Number.isInteger:
  // this rejects "-1", "1.5", "1e3", "", and whitespace-only strings without
  // needing separate range/integer checks, and it never misparses a
  // negative value as valid (node:util.parseArgs itself already rejects a
  // bare `--pacing-ms -1` as an ambiguous option before we even see it here
  // — this regex is what catches the `--pacing-ms=-1` form).
  const pacingMsRaw = values["pacing-ms"] as string | undefined;
  let pacingMs = 0;
  if (pacingMsRaw !== undefined) {
    if (!/^\d+$/.test(pacingMsRaw)) {
      return { ok: false, error: `--pacing-ms must be a non-negative integer (got "${pacingMsRaw}").` };
    }
    pacingMs = Number(pacingMsRaw);
  }

  return {
    ok: true,
    config: {
      strategy,
      threshold: strategy === "hybrid" ? (thresholdParsed.value ?? HYBRID_DEFAULT_THRESHOLD) : undefined,
      thresholds,
      limit: limitParsed.value,
      dryRun: values["dry-run"] === true,
      jevRunDir: values["jev-run"] as string | undefined,
      claudeRunDir: values["claude-run"] as string | undefined,
      datasetPath: (values.dataset as string | undefined) ?? defaults.datasetPath,
      outputDir: (values.out as string | undefined) ?? defaults.outputDir,
      pacingMs,
    },
  };
}

function isCliStrategy(value: string): value is CliStrategy {
  return value === "jev" || value === "claude" || value === "hybrid" || value === "threshold-simulation";
}

export interface DryRunPlan {
  dryRun: true;
  strategy: CliStrategy;
  threshold?: number;
  thresholds?: number[];
  datasetVersion: string;
  datasetHash: string;
  requestedCaseCount: number;
  actualCaseCount: number;
  fullDataset: boolean;
  providersThatWouldBeCalled: string[];
  maxPossibleProviderCalls: number | { jev: number; claude: number; total: number };
  pricingConfigVersion: string;
  outputDestination: string;
  gitCommit: string;
  gitDirty: boolean;
  /** Configured pacing, reported without ever sleeping — a dry-run previews the setting, it never waits (Phase 8C-B §11). */
  pacingMs: number;
}

/**
 * Makes zero provider calls and writes zero artifacts — purely computes
 * what a real run *would* do (Phase 7A design checkpoint §15/§16). For
 * Hybrid, the maximum possible Claude-call count is reported, never a
 * predicted actual count — that depends on live Jev confidence values not
 * yet observed.
 */
export function planDryRun(
  config: CliConfig,
  dataset: BenchmarkDataset,
  datasetHash: string,
  git: { commit: string; dirty: boolean },
): DryRunPlan {
  const requestedCaseCount = config.limit ?? dataset.cases.length;
  const actualCaseCount = Math.min(requestedCaseCount, dataset.cases.length);
  const fullDataset = config.limit === undefined;

  let providersThatWouldBeCalled: string[];
  let maxPossibleProviderCalls: DryRunPlan["maxPossibleProviderCalls"];

  switch (config.strategy) {
    case "jev":
      providersThatWouldBeCalled = ["jev"];
      maxPossibleProviderCalls = actualCaseCount;
      break;
    case "claude":
      providersThatWouldBeCalled = ["claude"];
      maxPossibleProviderCalls = actualCaseCount;
      break;
    case "hybrid":
      providersThatWouldBeCalled = ["jev", "claude"];
      maxPossibleProviderCalls = { jev: actualCaseCount, claude: actualCaseCount, total: actualCaseCount * 2 };
      break;
    case "threshold-simulation":
      providersThatWouldBeCalled = [];
      maxPossibleProviderCalls = 0;
      break;
  }

  return {
    dryRun: true,
    strategy: config.strategy,
    threshold: config.threshold,
    thresholds: config.thresholds,
    datasetVersion: dataset.version,
    datasetHash,
    requestedCaseCount,
    actualCaseCount,
    fullDataset,
    providersThatWouldBeCalled,
    maxPossibleProviderCalls,
    pricingConfigVersion: PRICING_CONFIG_VERSION,
    outputDestination: config.outputDir,
    gitCommit: git.commit,
    gitDirty: git.dirty,
    pacingMs: config.pacingMs,
  };
}
