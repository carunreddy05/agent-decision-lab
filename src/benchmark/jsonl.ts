import { readFileSync, writeFileSync } from "node:fs";

/** One JSON value per line — used for `cases.jsonl` result artifacts. */
export function writeJsonl(path: string, rows: readonly unknown[]): void {
  const content = rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : "");
  writeFileSync(path, content, "utf-8");
}

export function readJsonl<T>(path: string): T[] {
  const raw = readFileSync(path, "utf-8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}
