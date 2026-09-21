import { describe, expect, it } from "vitest";
import { assertValidRoutingDecision } from "@/domain/validate";
import { InvalidProviderOutputError } from "@/domain/errors";
import type { RoutingDecision } from "@/domain/route";

function validDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    route: "GITHUB",
    provider: "mock",
    model: "mock-keyword-v1",
    confidence: 0.9,
    probabilities: { GITHUB: 0.9, JIRA: 0.1 },
    latencyMs: 10,
    ...overrides,
  };
}

describe("assertValidRoutingDecision", () => {
  it("accepts a well-formed decision and returns it unchanged", () => {
    const decision = validDecision();
    expect(assertValidRoutingDecision(decision)).toBe(decision);
  });

  it("accepts a decision with no confidence/probabilities (e.g. a provider that doesn't expose them)", () => {
    const decision = validDecision({ confidence: undefined, probabilities: undefined });
    expect(() => assertValidRoutingDecision(decision)).not.toThrow();
  });

  it("rejects an invalid route", () => {
    const decision = validDecision({ route: "NOT_A_ROUTE" as never });
    expect(() => assertValidRoutingDecision(decision)).toThrow(InvalidProviderOutputError);
  });

  it("rejects an out-of-range confidence", () => {
    const decision = validDecision({ confidence: 1.5 });
    expect(() => assertValidRoutingDecision(decision)).toThrow(InvalidProviderOutputError);
  });

  it("rejects a malformed probabilities map", () => {
    const decision = validDecision({
      probabilities: { GITHUB: 1.2 },
    });
    expect(() => assertValidRoutingDecision(decision)).toThrow(InvalidProviderOutputError);
  });

  it("rejects a negative latency", () => {
    const decision = validDecision({ latencyMs: -1 });
    expect(() => assertValidRoutingDecision(decision)).toThrow(InvalidProviderOutputError);
  });

  it("rejects a decision missing provider or model", () => {
    const decision = validDecision({ provider: "" });
    expect(() => assertValidRoutingDecision(decision)).toThrow(InvalidProviderOutputError);
  });
});
