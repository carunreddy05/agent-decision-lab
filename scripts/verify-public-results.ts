/**
 * Phase 10C — reads ONLY the tracked, public-safe artifacts under
 * `benchmark/public-results/` and recomputes the headline benchmark
 * numbers reported in the README/benchmark-summary/experiment-evidence
 * documents. Makes zero provider calls, needs no API key, and modifies
 * nothing — it exists purely so an external reader can independently
 * verify the reported numbers without trusting prose alone.
 *
 * Reuses the exact same pure functions the real benchmark runner uses
 * (`src/benchmark/metrics/*`, `src/benchmark/threshold-simulation.ts`) —
 * this is a new *consumer* of existing architecture, not new scoring
 * logic.
 *
 * Usage: npx tsx scripts/verify-public-results.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeRouteAccuracy } from "@/benchmark/metrics/accuracy";
import { DEFAULT_SIMULATION_THRESHOLDS, simulateThreshold } from "@/benchmark/threshold-simulation";
import type { ClaudeOnlyCaseResult, JevOnlyCaseResult } from "@/benchmark/result-types";

const PUBLIC_DIR = path.resolve(import.meta.dirname, "../benchmark/public-results");

function readJsonl<T>(filePath: string): T[] {
  return readFileSync(filePath, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as T);
}

function main() {
  const jevRows = readJsonl<JevOnlyCaseResult>(path.join(PUBLIC_DIR, "jev-canonical/cases.jsonl"));
  const claudeRows = readJsonl<ClaudeOnlyCaseResult>(path.join(PUBLIC_DIR, "claude-canonical/cases.jsonl"));
  const incidentRows = readJsonl<JevOnlyCaseResult>(path.join(PUBLIC_DIR, "jev-rate-limit-incident/cases.jsonl"));
  const publishedThresholds = JSON.parse(
    readFileSync(path.join(PUBLIC_DIR, "hybrid-offline/threshold-analysis.json"), "utf-8"),
  ) as ReturnType<typeof simulateThreshold>[];

  console.log("=== Jev canonical baseline ===");
  const jevAccuracy = computeRouteAccuracy(
    jevRows.map((r) => ({
      expectedRoute: r.expectedRoute,
      succeeded: r.succeeded,
      correct: r.correctRoute,
      difficulty: r.difficulty,
      category: r.category,
    })),
  );
  console.log(`Route accuracy: ${jevAccuracy.overall.correct}/${jevAccuracy.overall.total}`);

  console.log("\n=== Claude canonical baseline ===");
  const claudeAccuracy = computeRouteAccuracy(
    claudeRows.map((r) => ({
      expectedRoute: r.expectedRoute,
      succeeded: r.succeeded,
      correct: r.correctRoute,
      difficulty: r.difficulty,
      category: r.category,
    })),
  );
  console.log(`Route accuracy: ${claudeAccuracy.overall.correct}/${claudeAccuracy.overall.total}`);

  console.log("\n=== Provider relationship ===");
  const claudeById = new Map(claudeRows.map((r) => [r.caseId, r]));
  let bothCorrect = 0;
  let jevCorrectClaudeWrong = 0;
  let jevWrongClaudeCorrect = 0;
  let bothWrong = 0;
  let sameRoute = 0;
  let diffRoute = 0;
  let bothWrongSameRoute = 0;
  let bothWrongDiffRoute = 0;
  for (const j of jevRows) {
    const c = claudeById.get(j.caseId);
    if (!c) continue;
    const jOk = j.correctRoute === true;
    const cOk = c.correctRoute === true;
    if (jOk && cOk) bothCorrect++;
    else if (jOk && !cOk) jevCorrectClaudeWrong++;
    else if (!jOk && cOk) jevWrongClaudeCorrect++;
    else bothWrong++;

    const same = j.route === c.route;
    if (same) sameRoute++;
    else diffRoute++;

    if (!jOk && !cOk) {
      if (same) bothWrongSameRoute++;
      else bothWrongDiffRoute++;
    }
  }
  console.log(`Both correct / Jev-only correct / Claude-only correct / both wrong: ${bothCorrect}/${jevCorrectClaudeWrong}/${jevWrongClaudeCorrect}/${bothWrong}`);
  console.log(`Same route / different route: ${sameRoute}/${diffRoute}`);
  console.log(`Both wrong, same route / different route: ${bothWrongSameRoute}/${bothWrongDiffRoute}`);

  console.log("\n=== RC-048 / RC-049 ===");
  for (const caseId of ["RC-048", "RC-049"]) {
    const j = jevRows.find((r) => r.caseId === caseId);
    const c = claudeById.get(caseId);
    console.log(
      `${caseId}: expected=${j?.expectedRoute} jevRoute=${j?.route} jevConfidence=${j?.confidence} claudeRoute=${c?.route}`,
    );
  }

  console.log("\n=== Offline Hybrid threshold reconstruction (independently recomputed from public cases.jsonl) ===");
  for (const threshold of DEFAULT_SIMULATION_THRESHOLDS) {
    const recomputed = simulateThreshold(jevRows, claudeRows, threshold);
    const published = publishedThresholds.find((t) => t.threshold === threshold);
    const matches =
      published !== undefined &&
      recomputed.simulatedFinalAccuracy === published.simulatedFinalAccuracy &&
      recomputed.simulatedClaudeCallCount === published.simulatedClaudeCallCount &&
      recomputed.simulatedEstimatedCostUsd === published.simulatedEstimatedCostUsd;
    console.log(
      `threshold=${threshold}: accuracy=${(recomputed.simulatedFinalAccuracy * 100).toFixed(1)}% ` +
        `claudeCalls=${recomputed.simulatedClaudeCallCount} ` +
        `cost=$${recomputed.simulatedEstimatedCostUsd.toFixed(6)} ` +
        `[matches published artifact: ${matches ? "YES" : "NO"}]`,
    );
  }

  console.log("\n=== Rate-limit incident (original unpaced Jev run — NOT a model-quality baseline) ===");
  const succeeded = incidentRows.filter((r) => r.succeeded).length;
  const failed = incidentRows.filter((r) => !r.succeeded).length;
  const errorCategories = [...new Set(incidentRows.filter((r) => !r.succeeded).map((r) => r.errorCategory))];
  console.log(`Succeeded: ${succeeded}/${incidentRows.length}, failed: ${failed}/${incidentRows.length}`);
  console.log(`Failure categories: ${errorCategories.join(", ")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
