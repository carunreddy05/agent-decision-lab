import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readJsonl, writeJsonl } from "@/benchmark/jsonl";

describe("jsonl", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "benchmark-jsonl-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips an array of objects, one JSON value per line", () => {
    const rows = [{ a: 1 }, { a: 2 }, { a: 3 }];
    const filePath = path.join(dir, "cases.jsonl");
    writeJsonl(filePath, rows);
    expect(readJsonl<{ a: number }>(filePath)).toEqual(rows);
  });

  it("round-trips an empty array", () => {
    const filePath = path.join(dir, "empty.jsonl");
    writeJsonl(filePath, []);
    expect(readJsonl(filePath)).toEqual([]);
  });
});
