import { createHash } from "node:crypto";
import type { BenchmarkDataset } from "./types";

/**
 * Deterministic hash of a dataset's content, independent of key order.
 * Used so a benchmark run can record exactly which ground truth it was
 * scored against, and later prove whether the dataset changed underneath it.
 */
export function hashDataset(dataset: BenchmarkDataset): string {
  const canonical = canonicalize(dataset);
  return createHash("sha256").update(canonical).digest("hex");
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
