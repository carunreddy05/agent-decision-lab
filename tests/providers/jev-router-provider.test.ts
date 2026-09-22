import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InvalidProviderOutputError,
  ProviderAuthenticationError,
  ProviderAuthorizationError,
  ProviderBillingError,
  ProviderRateLimitError,
  ProviderRequestError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from "@/domain/errors";
import { ROUTES, type Route } from "@/domain/route";
import { evaluatePolicy } from "@/policy/policy-engine";
import { JevRouterProvider } from "@/providers/jev/jev-router-provider";
import { ROUTING_SPEC_VERSION } from "@/providers/jev/routing-spec";
import { deriveAction } from "@/pipeline/derive-action";

/** Builds a `/v1/evaluate`-shaped response — see the wire-format reconciliation. */
function jevResponse(overrides: {
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number | null;
  model?: string;
  cost?: string;
} = {}) {
  const typesafeMetadata =
    overrides.confidence === null
      ? undefined
      : { confidence: { route: overrides.confidence ?? 0.85 } };

  return {
    model: overrides.model ?? "typesafe-ai/jev",
    answers: {
      route: {
        type: "choice",
        choice: overrides.choice ?? "GITHUB",
        probabilities:
          overrides.probabilities ??
          ({ DIRECT_ANSWER: 0.02, DOCS: 0.03, GITHUB: 0.85, JIRA: 0.08, REJECT: 0.02 } as Record<string, number>),
      },
    },
    usage: { inputTokens: 320, outputTokens: 20 },
    providerMetadata: {
      gateway: {
        routing: { resolvedProvider: "typesafe-ai" },
        cost: overrides.cost ?? "0.00001344",
        generationId: "gen_test123",
      },
      ...(typesafeMetadata ? { typesafe: typesafeMetadata } : {}),
    },
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("JevRouterProvider", () => {
  beforeEach(() => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("normalizes a successful choice response into a RoutingDecision", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(jevResponse())));
    const provider = new JevRouterProvider();

    const decision = await provider.decide({ prompt: "Check ENG-142 and find the code change that fixed it." });

    expect(decision.route).toBe("GITHUB");
    expect(decision.provider).toBe("jev");
    expect(decision.model).toBe("typesafe-ai/jev");
    expect(decision.confidence).toBe(0.85);
    expect(decision.probabilities?.GITHUB).toBe(0.85);
    expect(decision.routingSpecVersion).toBe(ROUTING_SPEC_VERSION);
    expect(decision.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reads confidence from providerMetadata.typesafe.confidence.route, not the answer object", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(jevResponse({ confidence: 0.42 }))));
    const provider = new JevRouterProvider();

    const decision = await provider.decide({ prompt: "any prompt" });
    expect(decision.confidence).toBe(0.42);
  });

  it("records reproducibility metadata: requested model identifier and an explicit unresolved-version note", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(jevResponse())));
    const provider = new JevRouterProvider();

    const decision = await provider.decide({ prompt: "any prompt" });
    expect(decision.rawMetadata?.requestedModelIdentifier).toBe("typesafe-ai/jev");
    expect(decision.rawMetadata?.resolvedModelIdentifier).toBeNull();
    expect(decision.rawMetadata?.modelVersionResolution).toMatch(/not exposed/i);
  });

  it.each(ROUTES)("normalizes a %s choice correctly", async (route: Route) => {
    const probabilities: Record<string, number> = { DIRECT_ANSWER: 0, DOCS: 0, GITHUB: 0, JIRA: 0, REJECT: 0 };
    probabilities[route] = 1;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(jevResponse({ choice: route, probabilities, confidence: 1 }))),
    );
    const provider = new JevRouterProvider();

    const decision = await provider.decide({ prompt: "any prompt" });
    expect(decision.route).toBe(route);
  });

  it("preserves per-route probabilities exactly as returned, without fabricating values", async () => {
    const probabilities = { DIRECT_ANSWER: 0.1, DOCS: 0.1, GITHUB: 0.5, JIRA: 0.2, REJECT: 0.1 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(jevResponse({ probabilities, confidence: 0.5 }))));
    const provider = new JevRouterProvider();

    const decision = await provider.decide({ prompt: "any prompt" });
    expect(decision.probabilities).toEqual(probabilities);
    expect(decision.confidence).toBe(0.5);
  });

  it("tolerates missing confidence metadata (leaves confidence undefined, does not error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(jevResponse({ confidence: null }))));
    const provider = new JevRouterProvider();

    const decision = await provider.decide({ prompt: "any prompt" });
    expect(decision.confidence).toBeUndefined();
    expect(decision.route).toBe("GITHUB");
  });

  it("throws InvalidProviderOutputError on a malformed (out-of-range) confidence value", async () => {
    const body = jevResponse();
    body.providerMetadata.typesafe = { confidence: { route: 1.5 } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body)));
    const provider = new JevRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(InvalidProviderOutputError);
  });

  it("captures camelCase token usage and separates provider-reported cost from our own estimate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(jevResponse())));
    const provider = new JevRouterProvider();

    const decision = await provider.decide({ prompt: "any prompt" });
    expect(decision.usage?.inputTokens).toBe(320);
    expect(decision.usage?.outputTokens).toBe(20);
    expect(decision.usage?.providerReportedCostUsd).toBeCloseTo(0.00001344, 10);
    expect(decision.usage?.estimatedCostUsd).toBeCloseTo((320 * 0.042) / 1_000_000, 10);
    expect(decision.usage?.providerReportedCostUsd).not.toBe(decision.usage?.estimatedCostUsd);
  });

  it("ignores a malformed cost string rather than producing NaN", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(jevResponse({ cost: "not-a-number" }))));
    const provider = new JevRouterProvider();

    const decision = await provider.decide({ prompt: "any prompt" });
    expect(decision.usage?.providerReportedCostUsd).toBeUndefined();
    expect(Number.isNaN(decision.usage?.providerReportedCostUsd)).toBe(false);
    expect(decision.usage?.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("throws InvalidProviderOutputError on an unrecognized route", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(jevResponse({ choice: "NOT_A_ROUTE" }))));
    const provider = new JevRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(InvalidProviderOutputError);
  });

  it("throws InvalidProviderOutputError when the route answer is missing", async () => {
    const body = jevResponse();
    // @ts-expect-error intentionally malformed for the test
    delete body.answers.route;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body)));
    const provider = new JevRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(InvalidProviderOutputError);
  });

  it("throws InvalidProviderOutputError on a probability outside [0, 1]", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(jevResponse({ probabilities: { DIRECT_ANSWER: 0, DOCS: 0, GITHUB: 1.5, JIRA: 0, REJECT: 0 } })),
        ),
    );
    const provider = new JevRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(InvalidProviderOutputError);
  });

  it("throws InvalidProviderOutputError on a malformed top-level response shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ nonsense: true })));
    const provider = new JevRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(InvalidProviderOutputError);
  });

  it("maps HTTP 401 to ProviderAuthenticationError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "bad key", error_type: "authentication_error" }, 401)),
    );
    const provider = new JevRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(ProviderAuthenticationError);
  });

  it("throws ProviderAuthenticationError immediately (no network call) when the API key env var is unset", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new JevRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(ProviderAuthenticationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps HTTP 429 to ProviderRateLimitError and captures Retry-After", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          jsonResponse({ message: "slow down", error_type: "rate_limit" }, 429, { "Retry-After": "2" }),
        ),
    );
    const provider = new JevRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(ProviderRateLimitError);

    try {
      await provider.decide({ prompt: "any prompt" });
      expect.unreachable("expected decide() to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderRateLimitError);
      expect((error as ProviderRateLimitError).retryAfterMs).toBe(2000);
    }
  });

  it("maps HTTP 402 to ProviderBillingError (account/billing, not a generic outage)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "no payment method", error_type: "billing_required" }, 402)),
    );
    const provider = new JevRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(ProviderBillingError);
  });

  it("maps HTTP 403 to ProviderAuthorizationError, distinct from 401 (real Phase 4 smoke-test case)", async () => {
    // The real smoke test that surfaced this gap returned a body-less 403 —
    // jsonResponse("") would fail to parse as JSON, exactly like that case.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    const provider = new JevRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(ProviderAuthorizationError);
  });

  it.each([400, 404, 409, 422])(
    "maps HTTP %i to ProviderRequestError (rejected request, not malformed output)",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse({ message: "bad request", error_type: "invalid_request" }, status)),
      );
      const provider = new JevRouterProvider();

      await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(ProviderRequestError);
    },
  );

  it("maps HTTP 504 to ProviderTimeoutError with origin 'upstream'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 504 })));
    const provider = new JevRouterProvider();

    try {
      await provider.decide({ prompt: "any prompt" });
      expect.unreachable("expected decide() to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderTimeoutError);
      expect((error as ProviderTimeoutError).origin).toBe("upstream");
    }
  });

  it("maps HTTP 529 (provider/server error) to ProviderUnavailableError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "overloaded", error_type: "overloaded" }, 529)),
    );
    const provider = new JevRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(ProviderUnavailableError);
  });

  it("maps a network failure to ProviderUnavailableError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const provider = new JevRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(ProviderUnavailableError);
  });

  it("maps a client-side abort (our own timeout) to ProviderTimeoutError with origin 'client'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const abortError = new Error("The operation was aborted.");
            abortError.name = "AbortError";
            reject(abortError);
          });
        });
      }),
    );
    const provider = new JevRouterProvider(20);

    try {
      await provider.decide({ prompt: "any prompt" });
      expect.unreachable("expected decide() to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderTimeoutError);
      expect((error as ProviderTimeoutError).origin).toBe("client");
    }
  });

  it("does not bypass policy: identical route/action produces identical policy regardless of provider name", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(jevResponse({ choice: "JIRA" }))));
    const provider = new JevRouterProvider();
    const decision = await provider.decide({ prompt: "Create a Jira ticket for this timeout." });

    const derived = deriveAction(decision.route, "Create a Jira ticket for this timeout.");
    const policy = derived.action ? evaluatePolicy(derived.action) : undefined;

    // evaluatePolicy's signature takes only an Action - "jev" vs "mock" as a
    // provider name is structurally unable to reach it, so this is really a
    // type-level guarantee; asserting the outcome here documents that.
    expect(policy?.result).toBe("REQUIRE_REVIEW");
    expect(policy?.action).toBe("CREATE_JIRA");
  });
});
