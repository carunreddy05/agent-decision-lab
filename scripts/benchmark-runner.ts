/**
 * Phase 7 benchmark runner — standalone script (tsx), outside the Next.js
 * app process, per CLAUDE.md's cost-safety guardrail. `--dry-run` makes zero
 * provider calls; a real (non-dry-run) `jev`/`claude`/`hybrid` run makes
 * live calls and costs money — it is never invoked from tests, app startup,
 * or the build, and every Phase 7B verification in this repo has only ever
 * used `--dry-run`.
 *
 * Usage:
 *   npm run benchmark -- --strategy jev --dry-run
 *   npm run benchmark -- --strategy claude --limit 5 --dry-run
 *   npm run benchmark -- --strategy hybrid --threshold 0.8 --dry-run
 *   npm run benchmark -- --strategy threshold-simulation --jev-run <dir> --claude-run <dir>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hashDataset } from "@/benchmark/hash";
import { loadDataset } from "@/benchmark/load-dataset";
import { runClaudeOnlyCase, runHybridCase, runJevOnlyCase, type CaseRunnerContext } from "@/benchmark/case-runner";
import { type CliConfig, parseCliArgs, planDryRun } from "@/benchmark/cli";
import { readJsonl, writeJsonl } from "@/benchmark/jsonl";
import { buildConfusionMatrix } from "@/benchmark/metrics/confusion-matrix";
import { computeCostStats, computeHybridCostStats } from "@/benchmark/metrics/cost";
import { computeFallbackStats } from "@/benchmark/metrics/fallback";
import { computeLatencyStats } from "@/benchmark/metrics/latency";
import { computeUsageStats } from "@/benchmark/metrics/usage";
import { computeLayerAccuracy, computeRouteAccuracy } from "@/benchmark/metrics/accuracy";
import { renderRunSummaryMarkdown, renderThresholdAnalysisMarkdown } from "@/benchmark/markdown-report";
import { buildManifest, buildRunId, getGitCommit, isGitDirty } from "@/benchmark/manifest";
import { PRICING_CONFIG_VERSION } from "@/benchmark/pricing-config";
import type { CaseResult, ClaudeOnlyCaseResult, HybridCaseResult, JevOnlyCaseResult } from "@/benchmark/result-types";
import { DEFAULT_SIMULATION_THRESHOLDS, simulateThreshold } from "@/benchmark/threshold-simulation";
import type { BenchmarkCase, BenchmarkDataset } from "@/benchmark/types";
import { ClaudeRouterProvider } from "@/providers/claude/claude-router-provider";
import { JevRouterProvider } from "@/providers/jev/jev-router-provider";
import { ROUTING_SPEC_VERSION } from "@/providers/routing-spec";

const DEFAULT_DATASET_PATH = path.resolve(import.meta.dirname, "../benchmark/datasets/routing-v1.0.json");
const DEFAULT_OUTPUT_DIR = path.resolve(import.meta.dirname, "../benchmark/results");

function selectCases(dataset: BenchmarkDataset, limit: number | undefined): BenchmarkCase[] {
  return limit !== undefined ? dataset.cases.slice(0, limit) : dataset.cases;
}

function printDryRunPlan(config: CliConfig, dataset: BenchmarkDataset): void {
  const datasetHash = hashDataset(dataset);
  const plan = planDryRun(config, dataset, datasetHash, { commit: getGitCommit(), dirty: isGitDirty() });
  console.log(JSON.stringify(plan, null, 2));
}

async function runProviderStrategy(config: CliConfig, dataset: BenchmarkDataset): Promise<void> {
  const cases = selectCases(dataset, config.limit);
  const datasetHash = hashDataset(dataset);
  const strategy = config.strategy === "jev" ? "JEV_ONLY" : config.strategy === "claude" ? "CLAUDE_ONLY" : "HYBRID";
  const runId = buildRunId(strategy, config.threshold);
  const gitCommit = getGitCommit();

  const ctx: CaseRunnerContext = {
    benchmarkRunId: runId,
    gitCommit,
    datasetVersion: dataset.version,
    datasetHash,
    routingSpecVersion: ROUTING_SPEC_VERSION,
  };

  const results: CaseResult[] = [];
  if (config.strategy === "jev") {
    const provider = new JevRouterProvider();
    for (const benchCase of cases) results.push(await runJevOnlyCase(benchCase, provider, ctx));
  } else if (config.strategy === "claude") {
    const provider = new ClaudeRouterProvider();
    for (const benchCase of cases) results.push(await runClaudeOnlyCase(benchCase, provider, ctx));
  } else {
    const jevProvider = new JevRouterProvider();
    const claudeProvider = new ClaudeRouterProvider();
    const threshold = config.threshold ?? 0.8;
    for (const benchCase of cases) results.push(await runHybridCase(benchCase, jevProvider, claudeProvider, threshold, ctx));
  }

  const manifest = buildManifest({
    runId,
    strategy,
    threshold: config.threshold,
    datasetVersion: dataset.version,
    datasetHash,
    routingSpecVersion: ROUTING_SPEC_VERSION,
    requestedCaseCount: config.limit ?? dataset.cases.length,
    actualCaseCount: cases.length,
    fullDataset: config.limit === undefined,
    dryRun: false,
  });

  const runDir = path.join(config.outputDir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
  writeJsonl(path.join(runDir, "cases.jsonl"), results);

  const routeAccuracy = computeRouteAccuracy(
    results.map((r) => ({
      expectedRoute: r.expectedRoute,
      succeeded: r.succeeded,
      correct: strategy === "HYBRID" ? (r as HybridCaseResult).finalCorrect : (r as JevOnlyCaseResult | ClaudeOnlyCaseResult).correctRoute,
      difficulty: r.difficulty,
      category: r.category,
    })),
  );
  const actionAccuracy = computeLayerAccuracy(results.map((r) => ({ annotated: r.expectedAction !== undefined, correct: r.actionCorrect })));
  const policyAccuracy = computeLayerAccuracy(results.map((r) => ({ annotated: r.expectedPolicy !== undefined, correct: r.policyCorrect })));
  const confusionMatrix = buildConfusionMatrix(
    results.map((r) => ({
      expectedRoute: r.expectedRoute,
      succeeded: r.succeeded,
      observedRoute: strategy === "HYBRID" ? (r as HybridCaseResult).finalRoute : (r as JevOnlyCaseResult | ClaudeOnlyCaseResult).route,
    })),
  );

  let costLines: string[];
  let usageLines: string[];
  const latency = computeLatencyStats(
    results.map((r) => ({
      succeeded: r.succeeded,
      latencyMs: strategy === "HYBRID" ? (r as HybridCaseResult).totalLatencyMs : (r as JevOnlyCaseResult | ClaudeOnlyCaseResult).latencyMs,
    })),
  );
  let fallback;

  if (strategy === "HYBRID") {
    const hybridResults = results as HybridCaseResult[];
    const cost = computeHybridCostStats(hybridResults);
    costLines = [
      `- Jev subtotal (estimated): $${cost.jevSubtotalEstimatedCostUsd.toFixed(6)}`,
      `- Claude subtotal (estimated): $${cost.claudeSubtotalEstimatedCostUsd.toFixed(6)}`,
      `- Total (estimated): $${cost.totalEstimatedCostUsd.toFixed(6)}`,
      `- Cost per fallback: ${cost.costPerFallbackUsd !== undefined ? `$${cost.costPerFallbackUsd.toFixed(6)}` : "n/a (no fallback)"}`,
    ];
    const jevUsage = computeUsageStats(hybridResults.map((r) => ({ inputTokens: r.jevInputTokens, outputTokens: r.jevOutputTokens })));
    const claudeUsage = computeUsageStats(
      hybridResults.filter((r) => r.claudeCalled).map((r) => ({ inputTokens: r.claudeInputTokens, outputTokens: r.claudeOutputTokens })),
    );
    usageLines = [
      `- Jev: ${jevUsage.totalInputTokens} in / ${jevUsage.totalOutputTokens} out tokens (n=${jevUsage.sampleCount})`,
      `- Claude: ${claudeUsage.totalInputTokens} in / ${claudeUsage.totalOutputTokens} out tokens (n=${claudeUsage.sampleCount})`,
    ];
    fallback = computeFallbackStats(hybridResults);
  } else {
    const singleResults = results as (JevOnlyCaseResult | ClaudeOnlyCaseResult)[];
    const cost = computeCostStats(singleResults);
    costLines = [
      `- Total (estimated): $${cost.totalEstimatedCostUsd.toFixed(6)}`,
      `- Mean (estimated): ${cost.meanEstimatedCostUsd !== undefined ? `$${cost.meanEstimatedCostUsd.toFixed(6)}` : "n/a"}`,
      `- Total (provider-reported): ${cost.totalProviderReportedCostUsd !== undefined ? `$${cost.totalProviderReportedCostUsd.toFixed(6)} (n=${cost.providerReportedCostSampleCount})` : "not reported by this provider"}`,
    ];
    const usage = computeUsageStats(singleResults);
    usageLines = [`- ${usage.totalInputTokens} in / ${usage.totalOutputTokens} out tokens (n=${usage.sampleCount})`];
  }

  const summaryJson = { manifest, routeAccuracy, actionAccuracy, policyAccuracy, latency, confusionMatrix, fallback };
  writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(summaryJson, null, 2), "utf-8");
  writeFileSync(path.join(runDir, "confusion-matrix.json"), JSON.stringify(confusionMatrix, null, 2), "utf-8");

  const summaryMd = renderRunSummaryMarkdown({
    manifest,
    routeAccuracy,
    actionAccuracy,
    policyAccuracy,
    latency,
    costLines,
    usageLines,
    fallback,
    confusionMatrix,
    confusionMatrixTitle: `${strategy} confusion matrix`,
  });
  writeFileSync(path.join(runDir, "summary.md"), summaryMd, "utf-8");

  console.log(`Wrote run artifacts to ${runDir}`);
}

function runThresholdSimulation(config: CliConfig, dataset: BenchmarkDataset): void {
  if (!config.jevRunDir || !config.claudeRunDir) {
    throw new Error("threshold-simulation requires --jev-run and --claude-run.");
  }
  const jevResults = readJsonl<JevOnlyCaseResult>(path.join(config.jevRunDir, "cases.jsonl"));
  const claudeResults = readJsonl<ClaudeOnlyCaseResult>(path.join(config.claudeRunDir, "cases.jsonl"));
  const thresholds = config.thresholds ?? [...DEFAULT_SIMULATION_THRESHOLDS];

  const results = thresholds.map((threshold) => simulateThreshold(jevResults, claudeResults, threshold));

  const runId = buildRunId("HYBRID", undefined);
  const runDir = path.join(config.outputDir, runId);
  mkdirSync(runDir, { recursive: true });

  const datasetHash = hashDataset(dataset);
  writeFileSync(path.join(runDir, "threshold-analysis.json"), JSON.stringify(results, null, 2), "utf-8");

  const md = renderThresholdAnalysisMarkdown({
    datasetVersion: dataset.version,
    datasetHash,
    routingSpecVersion: ROUTING_SPEC_VERSION,
    pricingConfigVersion: PRICING_CONFIG_VERSION,
    gitCommit: getGitCommit(),
    sourceJevRunId: path.basename(config.jevRunDir),
    sourceClaudeRunId: path.basename(config.claudeRunDir),
    results,
  });
  writeFileSync(path.join(runDir, "threshold-analysis.md"), md, "utf-8");

  console.log(`Wrote threshold analysis artifacts to ${runDir}`);
}

async function main() {
  const parsed = parseCliArgs(process.argv.slice(2), { datasetPath: DEFAULT_DATASET_PATH, outputDir: DEFAULT_OUTPUT_DIR });
  if (!parsed.ok) {
    console.error(`Error: ${parsed.error}`);
    process.exitCode = 1;
    return;
  }
  const { config } = parsed;
  const dataset = loadDataset(config.datasetPath);

  if (config.dryRun) {
    printDryRunPlan(config, dataset);
    return;
  }

  if (config.strategy === "threshold-simulation") {
    runThresholdSimulation(config, dataset);
    return;
  }

  await runProviderStrategy(config, dataset);
}

main();
