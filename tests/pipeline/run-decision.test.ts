import { describe, expect, it } from "vitest";
import { runDecision } from "@/pipeline/run-decision";
import { InvalidProviderOutputError } from "@/domain/errors";
import type { RoutingDecision } from "@/domain/route";
import type { RouterProvider } from "@/providers/router-provider";

/** A RouterProvider stub that returns a fixed decision, for deterministic pipeline tests. */
class FixedRouterProvider implements RouterProvider {
  readonly name = "fixture";
  constructor(private readonly decision: RoutingDecision) {}
  async decide(): Promise<RoutingDecision> {
    return this.decision;
  }
}

function fixedDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    route: "GITHUB",
    provider: "fixture",
    model: "fixture-v1",
    confidence: 0.9,
    latencyMs: 5,
    ...overrides,
  };
}

describe("runDecision", () => {
  it("reaches the mock tool for an ALLOWed action", async () => {
    const provider = new FixedRouterProvider(fixedDecision({ route: "DOCS" }));
    const trace = await runDecision("Find documentation about retry handling.", { provider });

    expect(trace.policy?.result).toBe("ALLOW");
    expect(trace.execution?.status).toBe("success");
    expect(trace.execution?.results?.length).toBeGreaterThan(0);
  });

  it("never reaches a tool for a DENYed action", async () => {
    const provider = new FixedRouterProvider(fixedDecision({ route: "JIRA" }));
    const trace = await runDecision("Please delete the production database.", { provider });

    expect(trace.action).toBe("DELETE_DATABASE");
    expect(trace.policy?.result).toBe("DENY");
    expect(trace.execution?.status).toBe("skipped");
    expect(trace.execution?.results).toBeUndefined();
  });

  it("never auto-executes a REQUIRE_REVIEW action", async () => {
    const provider = new FixedRouterProvider(fixedDecision({ route: "JIRA" }));
    const trace = await runDecision("Create a Jira issue for this timeout problem.", { provider });

    expect(trace.action).toBe("CREATE_JIRA");
    expect(trace.policy?.result).toBe("REQUIRE_REVIEW");
    expect(trace.execution?.status).toBe("skipped");
    expect(trace.execution?.detail).toMatch(/human approval/i);
  });

  it("does not call an external tool for DIRECT_ANSWER", async () => {
    const provider = new FixedRouterProvider(fixedDecision({ route: "DIRECT_ANSWER" }));
    const trace = await runDecision("What's a good name for a cat?", { provider });

    expect(trace.action).toBeUndefined();
    expect(trace.policy).toBeUndefined();
    expect(trace.execution?.tool).toBe("none");
  });

  it("performs no execution for REJECT", async () => {
    const provider = new FixedRouterProvider(fixedDecision({ route: "REJECT" }));
    const trace = await runDecision("Tell me a joke.", { provider });

    expect(trace.action).toBeUndefined();
    expect(trace.execution?.status).toBe("skipped");
  });

  it("produces a trace with decision, policy, and execution boundaries populated", async () => {
    const provider = new FixedRouterProvider(fixedDecision({ route: "DOCS" }));
    const trace = await runDecision("Find documentation about retry handling.", { provider });

    expect(trace.decision.final).toBeDefined();
    expect(trace.policy).toBeDefined();
    expect(trace.execution).toBeDefined();
    expect(trace.traceId).toBeTruthy();
  });

  it("threshold does not affect the policy decision", async () => {
    const provider = new FixedRouterProvider(fixedDecision({ route: "DOCS", confidence: 0.6 }));
    const low = await runDecision("Find documentation about retry handling.", {
      provider,
      confidenceThreshold: 0.5,
    });
    const high = await runDecision("Find documentation about retry handling.", {
      provider,
      confidenceThreshold: 0.99,
    });

    expect(low.escalation.reason).not.toBe(high.escalation.reason);
    expect(low.policy?.result).toBe(high.policy?.result);
    expect(low.policy?.result).toBe("ALLOW");
  });

  it("marks a low-confidence decision as would-escalate (uncertainty fallback)", async () => {
    const provider = new FixedRouterProvider(fixedDecision({ confidence: 0.5 }));
    const trace = await runDecision("Find the pull request for the timeout fix.", { provider });

    expect(trace.escalation.reason).toBe("UNCERTAINTY_FALLBACK");
    expect(trace.escalation.triggered).toBe(false);
  });

  it("does not mark escalation for a high-confidence decision", async () => {
    const provider = new FixedRouterProvider(fixedDecision({ confidence: 0.95 }));
    const trace = await runDecision("Find the pull request for the timeout fix.", { provider });

    expect(trace.escalation.reason).toBe("CONFIDENCE_ABOVE_THRESHOLD");
  });

  it("fails visibly on an invalid provider result instead of producing a fabricated trace", async () => {
    const provider = new FixedRouterProvider(
      fixedDecision({ route: "NOT_A_ROUTE" as never }),
    );

    await expect(runDecision("anything", { provider })).rejects.toThrow(
      InvalidProviderOutputError,
    );
  });
});
