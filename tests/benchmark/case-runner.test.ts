import { describe, expect, it } from "vitest";
import { runClaudeOnlyCase, runHybridCase, runJevOnlyCase, type CaseRunnerContext } from "@/benchmark/case-runner";
import type { BenchmarkCase } from "@/benchmark/types";
import { HybridFallbackFailedError, ProviderAuthenticationError, ProviderTimeoutError } from "@/domain/errors";
import type { RoutingDecision, RoutingRequest } from "@/domain/route";
import type { RouterProvider } from "@/providers/router-provider";

class StubProvider implements RouterProvider {
  constructor(
    public readonly name: string,
    private readonly impl: (request: RoutingRequest) => Promise<RoutingDecision>,
  ) {}
  decide(request: RoutingRequest): Promise<RoutingDecision> {
    return this.impl(request);
  }
}

const CTX: CaseRunnerContext = {
  benchmarkRunId: "test-run",
  gitCommit: "deadbeef",
  datasetVersion: "1.0",
  datasetHash: "hash123",
  routingSpecVersion: "routing-spec-v1",
};

function jiraReadCase(overrides: Partial<BenchmarkCase> = {}): BenchmarkCase {
  return {
    id: "RC-001",
    prompt: "What's the status of ticket ENG-142?",
    expectedRoute: "JIRA",
    expectedAction: "READ_JIRA",
    expectedPolicy: "ALLOW",
    difficulty: "CLEAR",
    category: "jira-read",
    ...overrides,
  };
}

function jevDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    route: "JIRA",
    provider: "jev",
    model: "typesafe-ai/jev",
    confidence: 0.92,
    probabilities: { JIRA: 0.92, GITHUB: 0.04, DOCS: 0.02, DIRECT_ANSWER: 0.01, REJECT: 0.01 },
    latencyMs: 120,
    usage: { inputTokens: 300, outputTokens: 5, estimatedCostUsd: 0.0000126, providerReportedCostUsd: 0.0000126 },
    rawMetadata: { requestedModelIdentifier: "typesafe-ai/jev", resolvedModelIdentifier: null },
    ...overrides,
  };
}

function claudeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    route: "JIRA",
    provider: "claude",
    model: "claude-sonnet-5",
    latencyMs: 900,
    usage: { inputTokens: 400, outputTokens: 8, estimatedCostUsd: 0.0008 },
    rawMetadata: { requestedModelIdentifier: "claude-sonnet-5", resolvedModelIdentifier: null },
    ...overrides,
  };
}

describe("runJevOnlyCase", () => {
  it("produces a full succeeded result with route/action/policy scoring", async () => {
    const provider = new StubProvider("jev", async () => jevDecision());
    const result = await runJevOnlyCase(jiraReadCase(), provider, CTX);

    expect(result.strategy).toBe("JEV_ONLY");
    expect(result.succeeded).toBe(true);
    expect(result.route).toBe("JIRA");
    expect(result.correctRoute).toBe(true);
    expect(result.confidence).toBe(0.92);
    expect(result.derivedAction).toBe("READ_JIRA");
    expect(result.actionCorrect).toBe(true);
    expect(result.policyResult).toBe("ALLOW");
    expect(result.policyCorrect).toBe(true);
    expect(result.resolvedModelIdentifier).toBeNull();
  });

  it("never includes the raw prompt text — only promptHash", async () => {
    const provider = new StubProvider("jev", async () => jevDecision());
    const result = await runJevOnlyCase(jiraReadCase(), provider, CTX);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("ENG-142");
    expect(result.promptHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces an explicit structured failure result rather than throwing or dropping the case", async () => {
    const provider = new StubProvider("jev", async () => {
      throw new ProviderTimeoutError("jev", "upstream");
    });
    const result = await runJevOnlyCase(jiraReadCase(), provider, CTX);

    expect(result.succeeded).toBe(false);
    expect(result.errorCategory).toBe("ProviderTimeoutError");
    expect(result.route).toBeUndefined();
    expect(result.caseId).toBe("RC-001");
  });

  it("marks correctRoute false on a routing mismatch without touching action/policy scoring", async () => {
    const provider = new StubProvider("jev", async () => jevDecision({ route: "GITHUB" }));
    const result = await runJevOnlyCase(jiraReadCase(), provider, CTX);

    expect(result.correctRoute).toBe(false);
    // deriveAction("GITHUB", ...) never mentions a PR number here, so it derives SEARCH_GITHUB_PR
    expect(result.derivedAction).toBe("SEARCH_GITHUB_PR");
    expect(result.actionCorrect).toBe(false);
  });
});

describe("runClaudeOnlyCase", () => {
  it("never fabricates confidence or probabilities", async () => {
    const provider = new StubProvider("claude", async () => claudeDecision());
    const result = await runClaudeOnlyCase(jiraReadCase(), provider, CTX);

    expect(result.strategy).toBe("CLAUDE_ONLY");
    expect("confidence" in result).toBe(false);
    expect("probabilities" in result).toBe(false);
  });

  it("produces a structured failure result on a technical failure", async () => {
    const provider = new StubProvider("claude", async () => {
      throw new ProviderAuthenticationError("claude", "missing key");
    });
    const result = await runClaudeOnlyCase(jiraReadCase(), provider, CTX);

    expect(result.succeeded).toBe(false);
    expect(result.errorCategory).toBe("ProviderAuthenticationError");
  });
});

describe("runHybridCase", () => {
  it("resolves without fallback when Jev confidence is above threshold", async () => {
    const jev = new StubProvider("jev", async () => jevDecision());
    const claude = new StubProvider("claude", async () => claudeDecision());
    const result = await runHybridCase(jiraReadCase(), jev, claude, 0.8, CTX);

    expect(result.succeeded).toBe(true);
    expect(result.fallbackTriggered).toBe(false);
    expect(result.claudeCalled).toBe(false);
    expect(result.finalProvider).toBe("jev");
    expect(result.finalRoute).toBe("JIRA");
    expect(result.finalCorrect).toBe(true);
    expect(result.jevResolvedWithoutFallback).toBe(true);
    expect(result.claudeCorrectedJev).toBe(false);
    expect(result.claudeRegressedJev).toBe(false);
  });

  it("escalates and records both decisions when confidence is below threshold", async () => {
    const jev = new StubProvider("jev", async () => jevDecision({ confidence: 0.3, route: "GITHUB" }));
    const claude = new StubProvider("claude", async () => claudeDecision({ route: "JIRA" }));
    const result = await runHybridCase(jiraReadCase(), jev, claude, 0.8, CTX);

    expect(result.fallbackTriggered).toBe(true);
    expect(result.fallbackReason).toBe("UNCERTAINTY_FALLBACK");
    expect(result.claudeCalled).toBe(true);
    expect(result.initialJevRoute).toBe("GITHUB");
    expect(result.initialJevCorrect).toBe(false);
    expect(result.claudeRoute).toBe("JIRA");
    expect(result.claudeCorrect).toBe(true);
    expect(result.finalRoute).toBe("JIRA");
    expect(result.finalCorrect).toBe(true);
    expect(result.claudeCorrectedJev).toBe(true);
    expect(result.claudeRegressedJev).toBe(false);
    expect(result.agreedWithClaude).toBe(false);
  });

  it("marks claudeRegressedJev when Jev was right and Claude's fallback makes it wrong", async () => {
    const jev = new StubProvider("jev", async () => jevDecision({ confidence: 0.3, route: "JIRA" }));
    const claude = new StubProvider("claude", async () => claudeDecision({ route: "GITHUB" }));
    const result = await runHybridCase(jiraReadCase(), jev, claude, 0.8, CTX);

    expect(result.initialJevCorrect).toBe(true);
    expect(result.finalCorrect).toBe(false);
    expect(result.claudeRegressedJev).toBe(true);
    expect(result.claudeCorrectedJev).toBe(false);
  });

  it("produces a structured failure result when Claude fails after fallback (HybridFallbackFailedError)", async () => {
    const jev = new StubProvider("jev", async () => jevDecision({ confidence: 0.3 }));
    const claude = new StubProvider("claude", async () => {
      throw new ProviderTimeoutError("claude", "client");
    });
    const result = await runHybridCase(jiraReadCase(), jev, claude, 0.8, CTX);

    expect(result.succeeded).toBe(false);
    expect(result.errorCategory).toBe("HybridFallbackFailedError");
    expect(result.fallbackTriggered).toBe(true);
    expect(result.claudeCalled).toBe(true);
    expect(result.fallbackReason).toBe("UNCERTAINTY_FALLBACK");
  });

  it("produces a structured failure result on a fail-fast Jev error (no fallback attempted)", async () => {
    const jev = new StubProvider("jev", async () => {
      throw new ProviderAuthenticationError("jev", "bad key");
    });
    const claude = new StubProvider("claude", async () => claudeDecision());
    const result = await runHybridCase(jiraReadCase(), jev, claude, 0.8, CTX);

    expect(result.succeeded).toBe(false);
    expect(result.errorCategory).toBe("ProviderAuthenticationError");
    expect(result.fallbackTriggered).toBe(false);
    expect(result.claudeCalled).toBe(false);
  });

  it("treats HybridFallbackFailedError safely — never leaks a raw provider response", async () => {
    const jev = new StubProvider("jev", async () => jevDecision({ confidence: 0.3 }));
    const claude = new StubProvider("claude", async () => {
      throw new HybridFallbackFailedError("UNCERTAINTY_FALLBACK", "JIRA", 0.3, undefined, "ProviderTimeoutError");
    });
    const result = await runHybridCase(jiraReadCase(), jev, claude, 0.8, CTX);
    expect(JSON.stringify(result)).not.toMatch(/api[_-]?key/i);
  });
});
