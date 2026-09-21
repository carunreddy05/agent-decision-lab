import { readFileSync } from "node:fs";
import type { BenchmarkDataset } from "./types";
import { validateDataset } from "./validate";

/**
 * Loads and validates a benchmark dataset from disk. Throws on any
 * structural or cross-field issue rather than returning a partially-valid
 * dataset — a benchmark run should never silently skip malformed cases.
 */
export function loadDataset(path: string): BenchmarkDataset {
  const raw = readFileSync(path, "utf-8");
  const dataset = JSON.parse(raw) as BenchmarkDataset;

  const issues = validateDataset(dataset);
  if (issues.length > 0) {
    const summary = issues.map((issue) => `  ${issue.caseId}: ${issue.message}`).join("\n");
    throw new Error(`invalid dataset at ${path}:\n${summary}`);
  }

  return dataset;
}
