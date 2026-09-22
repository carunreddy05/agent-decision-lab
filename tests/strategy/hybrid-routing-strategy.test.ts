import { describe, expect, it, vi } from "vitest";
import {
  HybridFallbackFailedError,
  InvalidProviderOutputError,
  ProviderAuthenticationError,
  ProviderAuthorizationError,
  ProviderBillingError,
  ProviderRateLimitError,
  ProviderRequestError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from "@/domain/errors";
import type { RoutingDecision, RoutingRequest } from "@/domain/route";
import type { RouterProvider } from "@/providers/router-provider";
import { decideHybrid } from "@/strategy/hybrid-routing-strategy";

/** A RouterProvider stub whose `decide` is a spy, for call-count/args assertions. */
class StubProvider implements RouterProvider {
  readonly decide: (request: RoutingRequest) => Promise<RoutingDecision>;
  constructor(
    public readonly name: string,
    impl: (request: RoutingRequest) => Promise<RoutingDecision>,
  ) {
    this.decide = vi.fn(impl);
  }
}

function jevDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    route: "JIRA",
    provider: "jev",
    model: "typesafe-ai/jev",
    confidence: 0.9,
    probabilities: { JIRA: 0.9, GITHUB: 0.05, DOCS: 0.02, DIRECT_ANSWER: 0.02, REJECT: 0.01 },
    latencyMs: 100,
    usage: { inputTokens: 300, outputTokens: 10, estimatedCostUsd: 0.0001 },
    ...overrides,
  };
}

function claudeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    route: "GITHUB",
    provider: "claude",
    model: "claude-sonnet-5",
    latencyMs: 2000,
    usage: { inputTokens: 900, outputTokens: 30, estimatedCostUsd: 0.002 },
    ...overrides,
  };
}

const jevReturning = (decision: RoutingDecision) => new StubProvider("jev", async () => decision);
const jevThrowing = (error: unknown) =>
  new StubProvider("jev", async () => {
    throw error;
  });
const claudeReturning = (decision: RoutingDecision) => new StubProvider("claude", async () => decision);
const claudeThrowing = (error: unknown) =>
  new StubProvider("claude", async () => {
    throw error;
  });

describe("decideHybrid", () => {
  it("A: Jev confidence above threshold — Claude not called, Jev final, no fallback", async () => {
    const jev = jevReturning(jevDecision({ confidence: 0.9 }));
    const claude = claudeReturning(claudeDecision());

    const result = await decideHybrid(
      { prompt: "x" },
      { jevProvider: jev, claudeProvider: claude, confidenceThreshold: 0.8 },
    );

    expect(claude.decide).not.toHaveBeenCalled();
    expect(result.finalDecision.provider).toBe("jev");
    expect(result.escalation.triggered).toBe(false);
    expect(result.escalation.reason).toBe("CONFIDENCE_ABOVE_THRESHOLD");
  });

  it("B: Jev confidence exactly equal to threshold — no fallback (>= means keep Jev)", async () => {
    const jev = jevReturning(jevDecision({ confidence: 0.8 }));
    const claude = claudeReturning(claudeDecision());

    const result = await decideHybrid(
      { prompt: "x" },
      { jevProvider: jev, claudeProvider: claude, confidenceThreshold: 0.8 },
    );

    expect(claude.decide).not.toHaveBeenCalled();
    expect(result.finalDecision.provider).toBe("jev");
    expect(result.escalation.triggered).toBe(false);
  });

  it("C: Jev confidence below threshold — Claude called exactly once with the raw prompt, UNCERTAINTY_FALLBACK, Claude final", async () => {
    const jev = jevReturning(jevDecision({ confidence: 0.5, route: "JIRA" }));
    const claude = claudeReturning(claudeDecision({ route: "GITHUB" }));

    const result = await decideHybrid(
      { prompt: "original prompt text" },
      { jevProvider: jev, claudeProvider: claude, confidenceThreshold: 0.8 },
    );

    expect(claude.decide).toHaveBeenCalledTimes(1);
    // Claude receives only the original raw request — no hint of Jev's
    // route, confidence, or that a fallback occurred.
    expect(claude.decide).toHaveBeenCalledWith({ prompt: "original prompt text" });
    expect(result.escalation.triggered).toBe(true);
    expect(result.escalation.reason).toBe("UNCERTAINTY_FALLBACK");
    expect(result.finalDecision.provider).toBe("claude");
    expect(result.finalDecision.route).toBe("GITHUB");
  });

  it("D: Jev confidence missing — Claude called, MISSING_CONFIDENCE_FALLBACK (not 0, not uncertainty, not technical failure)", async () => {
    const jev = jevReturning(jevDecision({ confidence: undefined }));
    const claude = claudeReturning(claudeDecision());

    const result = await decideHybrid({ prompt: "x" }, { jevProvider: jev, claudeProvider: claude });

    expect(claude.decide).toHaveBeenCalledTimes(1);
    expect(result.escalation.reason).toBe("MISSING_CONFIDENCE_FALLBACK");
    expect(result.escalation.triggered).toBe(true);
    expect(result.finalDecision.provider).toBe("claude");
  });

  it("E: Jev timeout — Claude fallback, TECHNICAL_FAILURE_FALLBACK, initial error category preserved", async () => {
    const jev = jevThrowing(new ProviderTimeoutError("jev"));
    const claude = claudeReturning(claudeDecision());

    const result = await decideHybrid({ prompt: "x" }, { jevProvider: jev, claudeProvider: claude });

    expect(result.escalation.reason).toBe("TECHNICAL_FAILURE_FALLBACK");
    expect(result.initialDecision).toBeUndefined();
    expect(result.hybridMeta.initialErrorCategory).toBe("ProviderTimeoutError");
    expect(result.finalDecision.provider).toBe("claude");
  });

  it("F: Jev unavailable/network — Claude fallback", async () => {
    const jev = jevThrowing(new ProviderUnavailableError("jev"));
    const claude = claudeReturning(claudeDecision());

    const result = await decideHybrid({ prompt: "x" }, { jevProvider: jev, claudeProvider: claude });

    expect(result.escalation.reason).toBe("TECHNICAL_FAILURE_FALLBACK");
    expect(result.hybridMeta.initialErrorCategory).toBe("ProviderUnavailableError");
  });

  it("G: Jev rate limit — Claude fallback", async () => {
    const jev = jevThrowing(new ProviderRateLimitError("jev", 1000));
    const claude = claudeReturning(claudeDecision());

    const result = await decideHybrid({ prompt: "x" }, { jevProvider: jev, claudeProvider: claude });

    expect(result.escalation.reason).toBe("TECHNICAL_FAILURE_FALLBACK");
    expect(result.hybridMeta.initialErrorCategory).toBe("ProviderRateLimitError");
  });

  it.each([
    ["authentication", () => new ProviderAuthenticationError("jev")],
    ["authorization", () => new ProviderAuthorizationError("jev")],
    ["billing", () => new ProviderBillingError("jev")],
    ["request", () => new ProviderRequestError("jev")],
    ["invalid output", () => new InvalidProviderOutputError("bad shape")],
  ])("H-L: Jev %s error fails fast — Claude never called, error propagates unchanged", async (_label, makeError) => {
    const error = makeError();
    const jev = jevThrowing(error);
    const claude = claudeReturning(claudeDecision());

    await expect(
      decideHybrid({ prompt: "x" }, { jevProvider: jev, claudeProvider: claude }),
    ).rejects.toBe(error);
    expect(claude.decide).not.toHaveBeenCalled();
  });

  it("M: Claude fails after UNCERTAINTY_FALLBACK — HybridFallbackFailedError, Jev context preserved, Jev decision not resurrected", async () => {
    const jev = jevReturning(jevDecision({ confidence: 0.5, route: "JIRA" }));
    const claude = claudeThrowing(new ProviderTimeoutError("claude"));

    try {
      await decideHybrid({ prompt: "x" }, { jevProvider: jev, claudeProvider: claude, confidenceThreshold: 0.8 });
      expect.unreachable("expected decideHybrid to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HybridFallbackFailedError);
      const e = error as HybridFallbackFailedError;
      expect(e.fallbackReason).toBe("UNCERTAINTY_FALLBACK");
      expect(e.initialRoute).toBe("JIRA");
      expect(e.initialConfidence).toBe(0.5);
      expect(e.claudeErrorCategory).toBe("ProviderTimeoutError");
    }
  });

  it("N: Claude fails after MISSING_CONFIDENCE_FALLBACK — HybridFallbackFailedError", async () => {
    const jev = jevReturning(jevDecision({ confidence: undefined, route: "DOCS" }));
    const claude = claudeThrowing(new ProviderRateLimitError("claude", 500));

    try {
      await decideHybrid({ prompt: "x" }, { jevProvider: jev, claudeProvider: claude });
      expect.unreachable("expected decideHybrid to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HybridFallbackFailedError);
      const e = error as HybridFallbackFailedError;
      expect(e.fallbackReason).toBe("MISSING_CONFIDENCE_FALLBACK");
      expect(e.initialRoute).toBe("DOCS");
      expect(e.initialConfidence).toBeUndefined();
      expect(e.claudeErrorCategory).toBe("ProviderRateLimitError");
    }
  });

  it("O: Claude fails after TECHNICAL_FAILURE_FALLBACK — HybridFallbackFailedError, no initial route/confidence since Jev never produced a decision", async () => {
    const jev = jevThrowing(new ProviderUnavailableError("jev"));
    const claude = claudeThrowing(new ProviderUnavailableError("claude"));

    try {
      await decideHybrid({ prompt: "x" }, { jevProvider: jev, claudeProvider: claude });
      expect.unreachable("expected decideHybrid to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HybridFallbackFailedError);
      const e = error as HybridFallbackFailedError;
      expect(e.fallbackReason).toBe("TECHNICAL_FAILURE_FALLBACK");
      expect(e.initialRoute).toBeUndefined();
      expect(e.initialConfidence).toBeUndefined();
      expect(e.initialErrorCategory).toBe("ProviderUnavailableError");
      expect(e.claudeErrorCategory).toBe("ProviderUnavailableError");
    }
  });

  it("P: Jev and Claude disagree — Claude is final after fallback, Jev's decision remains observable", async () => {
    const jev = jevReturning(jevDecision({ confidence: 0.5, route: "JIRA" }));
    const claude = claudeReturning(claudeDecision({ route: "GITHUB" }));

    const result = await decideHybrid(
      { prompt: "x" },
      { jevProvider: jev, claudeProvider: claude, confidenceThreshold: 0.8 },
    );

    expect(result.finalDecision.route).toBe("GITHUB");
    expect(result.initialDecision?.route).toBe("JIRA");
  });

  it("R: rejects an out-of-range threshold", async () => {
    const jev = jevReturning(jevDecision());
    const claude = claudeReturning(claudeDecision());

    for (const threshold of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        decideHybrid({ prompt: "x" }, { jevProvider: jev, claudeProvider: claude, confidenceThreshold: threshold }),
      ).rejects.toThrow();
    }
  });

  it("R: accepts threshold boundaries 0 and 1", async () => {
    const jev = jevReturning(jevDecision({ confidence: 0 }));
    const claude = claudeReturning(claudeDecision());

    await expect(
      decideHybrid({ prompt: "x" }, { jevProvider: jev, claudeProvider: claude, confidenceThreshold: 0 }),
    ).resolves.toBeDefined();

    const jevFull = jevReturning(jevDecision({ confidence: 1 }));
    await expect(
      decideHybrid({ prompt: "x" }, { jevProvider: jevFull, claudeProvider: claude, confidenceThreshold: 1 }),
    ).resolves.toBeDefined();
  });

  it("preserves per-provider cost provenance and computes totalEstimatedCostUsd as the sum when both providers ran", async () => {
    const jev = jevReturning(jevDecision({ confidence: 0.5, usage: { inputTokens: 300, outputTokens: 10, estimatedCostUsd: 0.0001 } }));
    const claude = claudeReturning(
      claudeDecision({ usage: { inputTokens: 900, outputTokens: 30, estimatedCostUsd: 0.002 } }),
    );

    const result = await decideHybrid(
      { prompt: "x" },
      { jevProvider: jev, claudeProvider: claude, confidenceThreshold: 0.8 },
    );

    expect(result.initialDecision?.usage?.estimatedCostUsd).toBe(0.0001);
    expect(result.claudeDecision?.usage?.estimatedCostUsd).toBe(0.002);
    expect(result.hybridMeta.totalEstimatedCostUsd).toBeCloseTo(0.0021, 10);
  });

  it("computes totalEstimatedCostUsd as Jev-only cost when no fallback occurs", async () => {
    const jev = jevReturning(
      jevDecision({ confidence: 0.95, usage: { inputTokens: 300, outputTokens: 10, estimatedCostUsd: 0.0001 } }),
    );
    const claude = claudeReturning(claudeDecision());

    const result = await decideHybrid(
      { prompt: "x" },
      { jevProvider: jev, claudeProvider: claude, confidenceThreshold: 0.8 },
    );

    expect(result.hybridMeta.totalEstimatedCostUsd).toBe(0.0001);
    expect(claude.decide).not.toHaveBeenCalled();
  });

  it("preserves per-provider latency via each RoutingDecision's own latencyMs (not usage) and reports total Hybrid latency separately", async () => {
    const jev = jevReturning(jevDecision({ confidence: 0.5, latencyMs: 150 }));
    const claude = claudeReturning(claudeDecision({ latencyMs: 2500 }));

    const result = await decideHybrid(
      { prompt: "x" },
      { jevProvider: jev, claudeProvider: claude, confidenceThreshold: 0.8 },
    );

    expect(result.initialDecision?.latencyMs).toBe(150);
    expect(result.claudeDecision?.latencyMs).toBe(2500);
    expect(result.hybridMeta.totalLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("preserves Jev's attempted latency in hybridMeta when Jev fails technically (no RoutingDecision exists to hold it)", async () => {
    const jev = jevThrowing(new ProviderUnavailableError("jev"));
    const claude = claudeReturning(claudeDecision());

    const result = await decideHybrid({ prompt: "x" }, { jevProvider: jev, claudeProvider: claude });

    expect(result.initialDecision).toBeUndefined();
    expect(result.hybridMeta.initialAttemptLatencyMs).toBeGreaterThanOrEqual(0);
  });
});
