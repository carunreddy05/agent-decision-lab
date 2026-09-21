import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hashDataset } from "@/benchmark/hash";
import type { BenchmarkDataset } from "@/benchmark/types";
import { validateDataset } from "@/benchmark/validate";

const DATASET_PATH = path.resolve(import.meta.dirname, "../../benchmark/datasets/routing-v1.0.json");

// Recorded when the dataset was locked (see benchmark/reports/phase3-review.md).
// This is an immutability guard, not a correctness check: v1.0 is frozen for
// the first Jev/Claude comparison, so any accidental edit should fail this
// test. A genuine labeling defect gets a new dataset version and file, with
// this hash updated deliberately alongside that version bump — never a
// silent edit to v1.0 itself.
const LOCKED_V1_0_HASH = "d3617240469f7b560e0d78adf9bee7afb500d8ccc650d9eac39bc76f7b952856";

function readDataset(): BenchmarkDataset {
  return JSON.parse(readFileSync(DATASET_PATH, "utf-8")) as BenchmarkDataset;
}

describe("routing-v1.0 dataset", () => {
  it("passes structural and cross-field validation with no issues", () => {
    const dataset = readDataset();
    expect(validateDataset(dataset)).toEqual([]);
  });

  it("is locked at version 1.0 with the recorded hash", () => {
    const dataset = readDataset();
    expect(dataset.version).toBe("1.0");
    expect(hashDataset(dataset)).toBe(LOCKED_V1_0_HASH);
  });

  it("has every case id unique", () => {
    const dataset = readDataset();
    const ids = dataset.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no empty prompts", () => {
    const dataset = readDataset();
    for (const c of dataset.cases) {
      expect(c.prompt.trim().length).toBeGreaterThan(0);
    }
  });

  it("labels every DELETE_DATABASE case DENY", () => {
    const dataset = readDataset();
    const destructive = dataset.cases.filter((c) => c.expectedAction === "DELETE_DATABASE");
    expect(destructive.length).toBeGreaterThan(0);
    for (const c of destructive) {
      expect(c.expectedPolicy).toBe("DENY");
    }
  });

  it("labels every CREATE_JIRA case REQUIRE_REVIEW", () => {
    const dataset = readDataset();
    const creations = dataset.cases.filter((c) => c.expectedAction === "CREATE_JIRA");
    expect(creations.length).toBeGreaterThan(0);
    for (const c of creations) {
      expect(c.expectedPolicy).toBe("REQUIRE_REVIEW");
    }
  });

  it("labels every read-only action ALLOW", () => {
    const dataset = readDataset();
    const readOnly = ["READ_DOCS", "SEARCH_GITHUB_PR", "READ_GITHUB_PR", "SEARCH_JIRA", "READ_JIRA"];
    for (const c of dataset.cases) {
      if (c.expectedAction && readOnly.includes(c.expectedAction)) {
        expect(c.expectedPolicy).toBe("ALLOW");
      }
    }
  });

  it("loads deterministically (stable hash across repeated reads)", () => {
    const first = hashDataset(readDataset());
    const second = hashDataset(readDataset());
    expect(first).toBe(second);
  });

  it("contains approximately 100 cases with representation for every route", () => {
    const dataset = readDataset();
    expect(dataset.cases.length).toBeGreaterThanOrEqual(90);
    expect(dataset.cases.length).toBeLessThanOrEqual(110);

    const routes = new Set(dataset.cases.map((c) => c.expectedRoute));
    expect(routes).toEqual(new Set(["DIRECT_ANSWER", "DOCS", "GITHUB", "JIRA", "REJECT"]));
  });

  it("contains at least one AMBIGUOUS case with notes explaining the ambiguity", () => {
    const dataset = readDataset();
    const ambiguous = dataset.cases.filter((c) => c.difficulty === "AMBIGUOUS");
    expect(ambiguous.length).toBeGreaterThan(0);
    for (const c of ambiguous) {
      expect(c.notes && c.notes.trim().length).toBeTruthy();
    }
  });

  it("flags invalid datasets (mutation test)", () => {
    const dataset = readDataset();
    const invalidCase = {
      id: "RC-BAD",
      prompt: "",
      expectedRoute: "NOT_A_ROUTE",
      difficulty: "CLEAR",
      category: "test",
    } as unknown as BenchmarkDataset["cases"][number];

    const broken: BenchmarkDataset = {
      ...dataset,
      cases: [
        ...dataset.cases,
        { ...dataset.cases[0] }, // duplicate id
        invalidCase,
      ],
    };
    const issues = validateDataset(broken);
    expect(issues.length).toBeGreaterThan(0);
  });
});
