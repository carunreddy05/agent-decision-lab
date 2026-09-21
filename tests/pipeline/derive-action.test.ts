import { describe, expect, it } from "vitest";
import { deriveAction } from "@/pipeline/derive-action";

describe("deriveAction", () => {
  it("detects destructive intent regardless of route", () => {
    // Route says DOCS, but the text clearly asks for something destructive —
    // the destructive check must win regardless, since a route is not a
    // safety signal.
    const derived = deriveAction("DOCS", "Please delete the production database.");
    expect(derived.action).toBe("DELETE_DATABASE");
  });

  it("maps DOCS to READ_DOCS", () => {
    const derived = deriveAction("DOCS", "Find documentation about retry handling.");
    expect(derived.action).toBe("READ_DOCS");
    expect(derived.params.query).toContain("retry handling");
  });

  it("maps GITHUB with a specific PR number to READ_GITHUB_PR", () => {
    const derived = deriveAction("GITHUB", "What does PR #431 change?");
    expect(derived.action).toBe("READ_GITHUB_PR");
    expect(derived.params.prNumber).toBe("431");
  });

  it("maps GITHUB with no PR number to SEARCH_GITHUB_PR", () => {
    const derived = deriveAction("GITHUB", "Find the pull request that fixed the checkout timeout.");
    expect(derived.action).toBe("SEARCH_GITHUB_PR");
  });

  it("maps JIRA with creation language to CREATE_JIRA", () => {
    const derived = deriveAction("JIRA", "Create a Jira issue for this timeout problem.");
    expect(derived.action).toBe("CREATE_JIRA");
    expect(derived.params.body).toBeTruthy();
  });

  it("maps JIRA with a specific ticket id to READ_JIRA", () => {
    const derived = deriveAction("JIRA", "Summarize ticket ENG-207.");
    expect(derived.action).toBe("READ_JIRA");
    expect(derived.params.ticketId).toBe("ENG-207");
  });

  it("maps JIRA with neither to SEARCH_JIRA", () => {
    const derived = deriveAction("JIRA", "Are there any open tickets about alerting?");
    expect(derived.action).toBe("SEARCH_JIRA");
  });

  it("proposes no action for DIRECT_ANSWER", () => {
    const derived = deriveAction("DIRECT_ANSWER", "What's a good name for a cat?");
    expect(derived.action).toBeNull();
  });

  it("proposes no action for REJECT", () => {
    const derived = deriveAction("REJECT", "Tell me a joke.");
    expect(derived.action).toBeNull();
  });
});
