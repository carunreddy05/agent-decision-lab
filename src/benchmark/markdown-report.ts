import type { AccuracyBreakdown, LayerAccuracySummary, RouteAccuracySummary } from "./metrics/accuracy";
import type { ConfusionMatrix } from "./metrics/confusion-matrix";
import { confusionMatrixToMarkdown } from "./metrics/confusion-matrix";
import type { FallbackStats } from "./metrics/fallback";
import type { LatencyStats } from "./metrics/latency";
import { BENCHMARK_LIMITATIONS } from "./limitations";
import type { RunManifest } from "./manifest";
import type { ThresholdAnalysisResult } from "./threshold-simulation";

/**
 * Markdown report rendering (Phase 7A design checkpoint §22). Descriptive
 * only — never generates a "winner," "best provider/threshold," or any
 * promotional conclusion. Every section exposes measurements and tradeoffs
 * and stops there.
 */

function formatPct(value: number | undefined): string {
  return value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function formatUsd(value: number | undefined): string {
  return value === undefined ? "n/a" : `$${value.toFixed(6)}`;
}

function formatMs(value: number | undefined): string {
  return value === undefined ? "n/a" : `${value.toFixed(1)} ms`;
}

function breakdownRow(label: string, breakdown: AccuracyBreakdown): string {
  return `| ${label} | ${breakdown.correct}/${breakdown.total} | ${formatPct(breakdown.accuracy)} |`;
}

function renderRouteAccuracySection(routeAccuracy: RouteAccuracySummary): string {
  const lines = [
    "## Routing accuracy",
    "",
    `Failed cases count as not-correct in every accuracy figure below (denominator includes them); provider failures are also reported separately.`,
    "",
    `- Provider failures: ${routeAccuracy.failureCount} (${formatPct(routeAccuracy.failureRate)})`,
    "",
    "| Breakdown | Correct/Total | Accuracy |",
    "|---|---|---|",
    breakdownRow("Overall", routeAccuracy.overall),
    ...Object.entries(routeAccuracy.byRoute).map(([route, b]) => breakdownRow(`Route: ${route}`, b)),
    ...Object.entries(routeAccuracy.byDifficulty).map(([difficulty, b]) => breakdownRow(`Difficulty: ${difficulty}`, b)),
    ...Object.entries(routeAccuracy.byCategory).map(([category, b]) => breakdownRow(`Category: ${category}`, b)),
  ];
  return lines.join("\n");
}

function renderLayerAccuracySection(title: string, summary: LayerAccuracySummary): string {
  return [
    `## ${title}`,
    "",
    `Kept independent of route accuracy (a mismatch here is not counted as a routing failure).`,
    "",
    `- Annotated cases: ${summary.annotatedCount}`,
    `- Correct: ${summary.correctCount}`,
    `- Accuracy: ${formatPct(summary.accuracy)}`,
  ].join("\n");
}

function renderLatencySection(latency: LatencyStats): string {
  return [
    "## Latency",
    "",
    "Mean/p50/p95 use successful completed decisions only; failed attempts are excluded from these and reported separately below.",
    "",
    `- Successful sample count: ${latency.successfulLatencySampleCount}`,
    `- Mean: ${formatMs(latency.meanMs)}`,
    `- p50: ${formatMs(latency.p50Ms)}`,
    `- p95: ${formatMs(latency.p95Ms)}`,
    `- Provider failures: ${latency.providerFailureCount}`,
    `- Failed-attempt latency sample count: ${latency.failedAttemptLatencySampleCount}`,
    `- Failed-attempt mean latency: ${formatMs(latency.failedAttemptLatencyMeanMs)}`,
  ].join("\n");
}

export interface RunSummaryReportData {
  manifest: RunManifest;
  routeAccuracy: RouteAccuracySummary;
  actionAccuracy: LayerAccuracySummary;
  policyAccuracy: LayerAccuracySummary;
  latency: LatencyStats;
  /** Pre-rendered lines so this module stays decoupled from every strategy-specific cost/usage shape. */
  costLines: readonly string[];
  usageLines: readonly string[];
  fallback?: FallbackStats;
  confusionMatrix: ConfusionMatrix;
  confusionMatrixTitle: string;
  highConfidenceErrorLines?: readonly string[];
  notes?: readonly string[];
}

export function renderRunSummaryMarkdown(data: RunSummaryReportData): string {
  const { manifest } = data;
  const sections: string[] = [
    `# Benchmark run summary — ${manifest.runId}`,
    "",
    "## Run metadata",
    "",
    `- Strategy: ${manifest.strategy}${manifest.threshold !== undefined ? ` (threshold ${manifest.threshold})` : ""}`,
    `- Schema version: ${manifest.benchmarkSchemaVersion}`,
    `- Timestamp: ${manifest.timestamp}`,
    `- Git commit: ${manifest.gitCommit}${manifest.gitDirty ? " (dirty working tree)" : ""}`,
    `- Dataset version: ${manifest.datasetVersion}`,
    `- Dataset hash: ${manifest.datasetHash}`,
    `- Routing spec version: ${manifest.routingSpecVersion}`,
    `- Requested model identifiers: ${JSON.stringify(manifest.requestedModelIdentifiers)}`,
    `- Pricing config version: ${manifest.pricingConfigVersion}`,
    `- Requested case count: ${manifest.requestedCaseCount}`,
    `- Actual case count: ${manifest.actualCaseCount}`,
    `- Full dataset: ${manifest.fullDataset ? "yes" : "NO — PARTIAL RUN"}`,
    "",
  ];

  if (!manifest.fullDataset) {
    sections.push(
      `> **PARTIAL RUN — ${manifest.actualCaseCount}/${manifest.requestedCaseCount >= manifest.actualCaseCount ? manifest.requestedCaseCount : manifest.actualCaseCount} cases.** This is not the full 100-case benchmark.`,
      "",
    );
  }

  sections.push(renderRouteAccuracySection(data.routeAccuracy), "");
  sections.push(renderLayerAccuracySection("Action-layer accuracy", data.actionAccuracy), "");
  sections.push(renderLayerAccuracySection("Policy-layer accuracy", data.policyAccuracy), "");
  sections.push(renderLatencySection(data.latency), "");

  sections.push("## Cost", "", ...data.costLines, "");
  sections.push("## Usage", "", ...data.usageLines, "");

  if (data.fallback) {
    sections.push(
      "## Fallback behavior",
      "",
      `- Total cases: ${data.fallback.totalCases}`,
      `- Fallback count: ${data.fallback.fallbackCount}`,
      `- Fallback rate: ${formatPct(data.fallback.fallbackRate)}`,
      `- Fallback by reason: ${JSON.stringify(data.fallback.fallbackByReason)}`,
      `- Claude call count: ${data.fallback.claudeCallCount}`,
      "",
    );
  }

  if (data.highConfidenceErrorLines) {
    sections.push(
      "## High-confidence routing errors",
      "",
      "Confidence is a provider-reported decision signal, not a calibrated probability of correctness — see CLAUDE.md. These counts do not imply \"X% confidence means X% chance of correctness.\"",
      "",
      ...data.highConfidenceErrorLines,
      "",
    );
  }

  sections.push(confusionMatrixToMarkdown(data.confusionMatrix, data.confusionMatrixTitle), "");

  if (data.notes && data.notes.length > 0) {
    sections.push("## Notes", "", ...data.notes.map((n) => `- ${n}`), "");
  }

  sections.push("## Limitations", "", ...BENCHMARK_LIMITATIONS.map((l) => `- ${l}`));

  return sections.join("\n");
}

export interface ThresholdAnalysisReportData {
  datasetVersion: string;
  datasetHash: string;
  routingSpecVersion: string;
  pricingConfigVersion: string;
  gitCommit: string;
  sourceJevRunId: string;
  sourceClaudeRunId: string;
  results: readonly ThresholdAnalysisResult[];
}

export function renderThresholdAnalysisMarkdown(data: ThresholdAnalysisReportData): string {
  const sections: string[] = [
    "# Offline threshold analysis — OFFLINE_THRESHOLD_SIMULATION",
    "",
    "**This is not a live Hybrid run.** Every figure below is reconstructed offline from independently-collected JEV_ONLY and CLAUDE_ONLY baseline results, matched by case id. No provider calls were made to produce this analysis, and no total/mean/p50/p95 Hybrid latency is reported here — real orchestration latency can only come from a genuine live decideHybrid() run.",
    "",
    `- Source JEV_ONLY run: ${data.sourceJevRunId}`,
    `- Source CLAUDE_ONLY run: ${data.sourceClaudeRunId}`,
    `- Dataset version: ${data.datasetVersion}`,
    `- Dataset hash: ${data.datasetHash}`,
    `- Routing spec version: ${data.routingSpecVersion}`,
    `- Pricing config version: ${data.pricingConfigVersion}`,
    `- Git commit: ${data.gitCommit}`,
    "",
    "A Jev technical failure observed in the JEV_ONLY baseline is time-dependent and not assumed to recur on a genuine live call — such cases are excluded from `reconstructableCases` below and counted in `nonReconstructableTechnicalFailureCount` instead.",
    "",
    "## Threshold tradeoffs",
    "",
    "No automatic ranking or \"best threshold\" is computed — the columns below are tradeoffs to read side by side.",
    "",
    "| Threshold | Reconstructable | Non-reconstructable (Jev tech. failure) | simulatedFinalAccuracy | simulatedFallbackRate | simulatedClaudeCallCount | correctJevEscalated | incorrectJevEscalated | incorrectJevNotEscalated | claudeCorrections | claudeRegressions | simulatedEstimatedCostUsd |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...data.results.map(
      (r) =>
        `| ${r.threshold} | ${r.reconstructableCases} | ${r.nonReconstructableTechnicalFailureCount} | ${formatPct(r.simulatedFinalAccuracy)} | ${formatPct(r.simulatedFallbackRate)} | ${r.simulatedClaudeCallCount} | ${r.correctJevEscalatedCount} | ${r.incorrectJevEscalatedCount} | ${r.incorrectJevNotEscalatedCount} | ${r.claudeCorrectionsCount} | ${r.claudeRegressionsCount} | ${formatUsd(r.simulatedEstimatedCostUsd)} |`,
    ),
    "",
    "## Limitations",
    "",
    ...BENCHMARK_LIMITATIONS.map((l) => `- ${l}`),
  ];

  return sections.join("\n");
}
