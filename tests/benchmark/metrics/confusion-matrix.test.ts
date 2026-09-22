import { describe, expect, it } from "vitest";
import { buildConfusionMatrix, confusionMatrixToMarkdown } from "@/benchmark/metrics/confusion-matrix";

describe("buildConfusionMatrix", () => {
  it("increments matrix[expected][observed] for a successful case", () => {
    const cm = buildConfusionMatrix([
      { expectedRoute: "JIRA", succeeded: true, observedRoute: "JIRA" },
      { expectedRoute: "JIRA", succeeded: true, observedRoute: "GITHUB" },
    ]);
    expect(cm.matrix.JIRA.JIRA).toBe(1);
    expect(cm.matrix.JIRA.GITHUB).toBe(1);
    expect(cm.matrix.JIRA.DOCS).toBe(0);
  });

  it("never maps a provider failure onto REJECT — routes it to a separate FAILURE column instead", () => {
    const cm = buildConfusionMatrix([{ expectedRoute: "DOCS", succeeded: false }]);
    expect(cm.matrix.DOCS.REJECT).toBe(0);
    expect(cm.failureColumn.DOCS).toBe(1);
  });

  it("keeps the failure column separate even when observedRoute happens to be REJECT for a successful case", () => {
    const cm = buildConfusionMatrix([{ expectedRoute: "DOCS", succeeded: true, observedRoute: "REJECT" }]);
    expect(cm.matrix.DOCS.REJECT).toBe(1);
    expect(cm.failureColumn.DOCS).toBe(0);
  });

  it("includes every route even with zero observations", () => {
    const cm = buildConfusionMatrix([]);
    expect(cm.matrix.DIRECT_ANSWER.DIRECT_ANSWER).toBe(0);
    expect(cm.failureColumn.REJECT).toBe(0);
  });
});

describe("confusionMatrixToMarkdown", () => {
  it("renders a header, separator, one row per route, and a FAILURE column", () => {
    const cm = buildConfusionMatrix([{ expectedRoute: "JIRA", succeeded: false }]);
    const md = confusionMatrixToMarkdown(cm, "Test matrix");
    expect(md).toContain("### Test matrix");
    expect(md).toContain("FAILURE");
    expect(md).toContain("| JIRA |");
  });
});
