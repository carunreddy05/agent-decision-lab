import { describe, expect, it } from "vitest";
import { MockRouterProvider } from "@/providers/mock/mock-provider";

const provider = new MockRouterProvider();

describe("MockRouterProvider", () => {
  it("routes a ticket-referencing prompt to JIRA", async () => {
    const decision = await provider.decide({ prompt: "What is the status of ENG-142?" });
    expect(decision.route).toBe("JIRA");
  });

  it("routes a pull-request prompt to GITHUB", async () => {
    const decision = await provider.decide({
      prompt: "Find the pull request that fixed the checkout timeout.",
    });
    expect(decision.route).toBe("GITHUB");
  });

  it("routes a how-to prompt to DOCS", async () => {
    const decision = await provider.decide({ prompt: "How do I deploy to Kubernetes?" });
    expect(decision.route).toBe("DOCS");
  });

  it("routes a destructive-sounding prompt to REJECT", async () => {
    const decision = await provider.decide({ prompt: "Please delete the production database." });
    expect(decision.route).toBe("REJECT");
  });

  it("falls back to DIRECT_ANSWER when nothing matches", async () => {
    const decision = await provider.decide({ prompt: "What's a good name for a cat?" });
    expect(decision.route).toBe("DIRECT_ANSWER");
  });

  it("returns probabilities that sum to ~1 and a confidence matching the chosen route", async () => {
    const decision = await provider.decide({ prompt: "Find PR #431" });
    const total = Object.values(decision.probabilities ?? {}).reduce((sum, p) => sum + p, 0);
    expect(total).toBeCloseTo(1, 2);
    expect(decision.confidence).toBe(decision.probabilities?.[decision.route]);
  });

  it("reports its own provider name and a non-negative latency", async () => {
    const decision = await provider.decide({ prompt: "hello" });
    expect(decision.provider).toBe("mock");
    expect(decision.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
