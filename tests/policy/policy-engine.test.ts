import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "@/policy/policy-engine";
import type { Action } from "@/domain/action";

describe("evaluatePolicy", () => {
  const allowedActions: Action[] = [
    "READ_DOCS",
    "SEARCH_GITHUB_PR",
    "READ_GITHUB_PR",
    "SEARCH_JIRA",
    "READ_JIRA",
  ];

  it.each(allowedActions)("ALLOWs read-only action %s", (action) => {
    expect(evaluatePolicy(action).result).toBe("ALLOW");
  });

  it("REQUIRE_REVIEWs creating a Jira ticket", () => {
    const decision = evaluatePolicy("CREATE_JIRA");
    expect(decision.result).toBe("REQUIRE_REVIEW");
    expect(decision.reason).toBeTruthy();
  });

  it("DENYs a destructive action regardless of context", () => {
    const decision = evaluatePolicy("DELETE_DATABASE");
    expect(decision.result).toBe("DENY");
  });

  it("returns the action and a non-empty reason alongside the result", () => {
    const decision = evaluatePolicy("READ_DOCS");
    expect(decision.action).toBe("READ_DOCS");
    expect(decision.reason.length).toBeGreaterThan(0);
  });
});
