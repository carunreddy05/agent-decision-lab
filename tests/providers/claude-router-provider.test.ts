import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
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
import { deriveAction } from "@/pipeline/derive-action";
import { ClaudeRouterProvider } from "@/providers/claude/claude-router-provider";
import { ROUTING_SPEC_VERSION } from "@/providers/routing-spec";

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", async () => {
  const actual = await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk");
  // A regular `function`, not an arrow function — the mock must be
  // `new`-constructible, and returning an object from a constructor call
  // overrides `this` with that object (standard JS constructor semantics).
  const MockAnthropic = vi.fn().mockImplementation(function () {
    return { messages: { create: mockCreate } };
  });
  // Explicitly copy each typed exception class rather than Object.assign —
  // these are attached to the real class in a way that isn't necessarily
  // own-enumerable, so a blanket copy silently drops them.
  const errorClassNames = [
    "AnthropicError",
    "APIError",
    "APIUserAbortError",
    "APIConnectionError",
    "APIConnectionTimeoutError",
    "BadRequestError",
    "AuthenticationError",
    "PermissionDeniedError",
    "NotFoundError",
    "ConflictError",
    "UnprocessableEntityError",
    "RateLimitError",
    "InternalServerError",
  ];
  for (const name of errorClassNames) {
    (MockAnthropic as unknown as Record<string, unknown>)[name] = (
      actual.default as unknown as Record<string, unknown>
    )[name];
  }
  return { ...actual, default: MockAnthropic };
});

function toolUseResponse(overrides: { route?: string; model?: string; stopReason?: string } = {}) {
  return {
    id: "msg_test123",
    model: overrides.model ?? "claude-sonnet-5",
    stop_reason: overrides.stopReason ?? "tool_use",
    content: [
      {
        type: "tool_use",
        id: "toolu_test",
        name: "select_route",
        input: { route: overrides.route ?? "GITHUB" },
      },
    ],
    usage: { input_tokens: 240, output_tokens: 12 },
  };
}

describe("ClaudeRouterProvider", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    mockCreate.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("normalizes a successful tool-use response into a RoutingDecision", async () => {
    mockCreate.mockResolvedValue(toolUseResponse());
    const provider = new ClaudeRouterProvider();

    const decision = await provider.decide({ prompt: "Find the pull request that fixed the checkout bug." });

    expect(decision.route).toBe("GITHUB");
    expect(decision.provider).toBe("claude");
    expect(decision.model).toBe("claude-sonnet-5");
    expect(decision.routingSpecVersion).toBe(ROUTING_SPEC_VERSION);
    expect(decision.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it.each(ROUTES)("normalizes a %s tool call correctly", async (route: Route) => {
    mockCreate.mockResolvedValue(toolUseResponse({ route }));
    const provider = new ClaudeRouterProvider();

    const decision = await provider.decide({ prompt: "any prompt" });
    expect(decision.route).toBe(route);
  });

  it("never fabricates confidence or probabilities", async () => {
    mockCreate.mockResolvedValue(toolUseResponse());
    const provider = new ClaudeRouterProvider();

    const decision = await provider.decide({ prompt: "any prompt" });
    expect(decision.confidence).toBeUndefined();
    expect(decision.probabilities).toBeUndefined();
  });

  it("uses disabled thinking and no sampling parameters, per Phase 5 approval", async () => {
    mockCreate.mockResolvedValue(toolUseResponse());
    const provider = new ClaudeRouterProvider();
    await provider.decide({ prompt: "any prompt" });

    const [params] = mockCreate.mock.calls[0];
    expect(params.thinking).toEqual({ type: "disabled" });
    expect(params.temperature).toBeUndefined();
    expect(params.top_p).toBeUndefined();
    expect(params.top_k).toBeUndefined();
    expect(params.tool_choice).toEqual({ type: "tool", name: "select_route" });
  });

  it("configures maxRetries: 0 and the expected timeout", async () => {
    mockCreate.mockResolvedValue(toolUseResponse());
    const provider = new ClaudeRouterProvider(5000);
    await provider.decide({ prompt: "any prompt" });

    const [, options] = mockCreate.mock.calls[0];
    expect(options).toEqual({ timeout: 5000, maxRetries: 0 });
  });

  it("normalizes real usage into UsageMetadata and computes estimatedCostUsd without a providerReportedCostUsd", async () => {
    mockCreate.mockResolvedValue(toolUseResponse());
    const provider = new ClaudeRouterProvider();

    const decision = await provider.decide({ prompt: "any prompt" });
    expect(decision.usage?.inputTokens).toBe(240);
    expect(decision.usage?.outputTokens).toBe(12);
    expect(decision.usage?.estimatedCostUsd).toBeCloseTo((240 * 2.0 + 12 * 10.0) / 1_000_000, 10);
    expect(decision.usage?.providerReportedCostUsd).toBeUndefined();
  });

  it("records reproducibility metadata: requested identifier, explicit null resolved identifier, and request id", async () => {
    mockCreate.mockResolvedValue(toolUseResponse());
    const provider = new ClaudeRouterProvider();

    const decision = await provider.decide({ prompt: "any prompt" });
    expect(decision.rawMetadata?.requestedModelIdentifier).toBe("claude-sonnet-5");
    expect(decision.rawMetadata?.resolvedModelIdentifier).toBeNull();
    expect(decision.rawMetadata?.requestId).toBe("msg_test123");
  });

  it("throws InvalidProviderOutputError on an unrecognized route", async () => {
    mockCreate.mockResolvedValue(toolUseResponse({ route: "NOT_A_ROUTE" }));
    const provider = new ClaudeRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(InvalidProviderOutputError);
  });

  it("throws InvalidProviderOutputError when no matching tool call is present", async () => {
    const response = toolUseResponse();
    response.content = [];
    mockCreate.mockResolvedValue(response);
    const provider = new ClaudeRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(InvalidProviderOutputError);
  });

  it("throws InvalidProviderOutputError on stop_reason 'refusal'", async () => {
    mockCreate.mockResolvedValue(toolUseResponse({ stopReason: "refusal" }));
    const provider = new ClaudeRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(InvalidProviderOutputError);
  });

  it("throws InvalidProviderOutputError on stop_reason 'max_tokens' (truncated tool call)", async () => {
    mockCreate.mockResolvedValue(toolUseResponse({ stopReason: "max_tokens" }));
    const provider = new ClaudeRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(InvalidProviderOutputError);
  });

  it("throws ProviderAuthenticationError immediately (no API call) when the API key env var is unset", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const provider = new ClaudeRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(ProviderAuthenticationError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("maps AuthenticationError (401) to ProviderAuthenticationError", async () => {
    mockCreate.mockRejectedValue(
      new Anthropic.AuthenticationError(401, { type: "authentication_error", message: "bad key" }, "bad key", new Headers()),
    );
    const provider = new ClaudeRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(ProviderAuthenticationError);
  });

  it("maps a 402 APIError to ProviderBillingError", async () => {
    mockCreate.mockRejectedValue(
      new Anthropic.APIError(402, { type: "billing_error", message: "no payment method" }, "no payment method", new Headers()),
    );
    const provider = new ClaudeRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(ProviderBillingError);
  });

  it("maps PermissionDeniedError (403) to ProviderAuthorizationError", async () => {
    mockCreate.mockRejectedValue(
      new Anthropic.PermissionDeniedError(403, { type: "permission_error", message: "not allowed" }, "not allowed", new Headers()),
    );
    const provider = new ClaudeRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(ProviderAuthorizationError);
  });

  it.each([
    ["BadRequestError", 400],
    ["NotFoundError", 404],
    ["ConflictError", 409],
    ["UnprocessableEntityError", 422],
  ])("maps %s to ProviderRequestError", async (className) => {
    const ErrorClass = (Anthropic as unknown as Record<string, new (...args: unknown[]) => Error>)[className];
    mockCreate.mockRejectedValue(
      new ErrorClass(0, { type: "invalid_request_error", message: "bad request" }, "bad request", new Headers()),
    );
    const provider = new ClaudeRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(ProviderRequestError);
  });

  it("maps RateLimitError (429) to ProviderRateLimitError and captures Retry-After", async () => {
    mockCreate.mockRejectedValue(
      new Anthropic.RateLimitError(
        429,
        { type: "rate_limit_error", message: "slow down" },
        "slow down",
        new Headers({ "retry-after": "3" }),
      ),
    );
    const provider = new ClaudeRouterProvider();

    try {
      await provider.decide({ prompt: "any prompt" });
      expect.unreachable("expected decide() to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderRateLimitError);
      expect((error as ProviderRateLimitError).retryAfterMs).toBe(3000);
    }
  });

  it("maps InternalServerError (5xx) to ProviderUnavailableError", async () => {
    mockCreate.mockRejectedValue(
      new Anthropic.InternalServerError(500, { type: "api_error", message: "oops" }, "oops", new Headers()),
    );
    const provider = new ClaudeRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(ProviderUnavailableError);
  });

  it("maps a network failure (APIConnectionError) to ProviderUnavailableError", async () => {
    mockCreate.mockRejectedValue(new Anthropic.APIConnectionError({ message: "ECONNRESET" }));
    const provider = new ClaudeRouterProvider();

    await expect(provider.decide({ prompt: "any prompt" })).rejects.toThrow(ProviderUnavailableError);
  });

  it("maps a client timeout (APIConnectionTimeoutError) to ProviderTimeoutError with origin 'client'", async () => {
    mockCreate.mockRejectedValue(new Anthropic.APIConnectionTimeoutError());
    const provider = new ClaudeRouterProvider();

    try {
      await provider.decide({ prompt: "any prompt" });
      expect.unreachable("expected decide() to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderTimeoutError);
      expect((error as ProviderTimeoutError).origin).toBe("client");
    }
  });

  describe("failure diagnostic logging", () => {
    const SECRET_KEY = "test-key";
    const SENSITIVE_PROMPT = "Find the pull request that introduced request tracing in the inventory service.";

    /**
     * Builds an error exactly the way the real SDK does for an actual HTTP
     * failure (client.js: parses the response body as JSON, then calls
     * `APIError.generate(status, parsedBody, undefined, headers)`) — using
     * the real, nested envelope shape Anthropic documents
     * (`{type: "error", error: {type, message}, request_id}`), not a
     * flattened approximation. This matters: constructing a typed error
     * class directly with a flat `{type, message}` body (as the mapping
     * tests above do, for their own narrower purpose) produces a different
     * `.message` shape than a real failure does, which is exactly the gap
     * that motivated fixing `extractSafeMessage` in the first place.
     */
    function realHttpError(status: number, errorType: string, message: string, requestId: string) {
      return Anthropic.APIError.generate(
        status,
        { type: "error", error: { type: errorType, message }, request_id: requestId },
        undefined,
        new Headers({ "request-id": requestId }),
      );
    }

    it("logs safe fields (status, error class, type, message, requestId, latency) on an HTTP error", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockCreate.mockRejectedValue(
        realHttpError(401, "authentication_error", "invalid x-api-key", "req_diagnostic_test"),
      );
      const provider = new ClaudeRouterProvider();

      await expect(provider.decide({ prompt: SENSITIVE_PROMPT })).rejects.toThrow(ProviderAuthenticationError);

      const [tag, payload] = consoleSpy.mock.calls[0];
      expect(tag).toBe("[claude-provider-failure]");
      const logged = JSON.parse(payload as string);
      expect(logged.provider).toBe("claude");
      expect(logged.category).toBe("http");
      expect(logged.errorClass).toBe("AuthenticationError");
      expect(logged.status).toBe(401);
      expect(logged.errorType).toBe("authentication_error");
      // The safe *nested* message only — never the JSON-stringified raw
      // envelope that `error.message` (Error.prototype.message) would give.
      expect(logged.message).toBe("invalid x-api-key");
      expect(logged.requestId).toBe("req_diagnostic_test");
      expect(typeof logged.latencyMs).toBe("number");

      consoleSpy.mockRestore();
    });

    it("logs a network-category entry (no status/type/requestId) for a connection failure", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockCreate.mockRejectedValue(new Anthropic.APIConnectionError({ message: "ECONNRESET" }));
      const provider = new ClaudeRouterProvider();

      await expect(provider.decide({ prompt: SENSITIVE_PROMPT })).rejects.toThrow(ProviderUnavailableError);

      const [, payload] = consoleSpy.mock.calls[0];
      const logged = JSON.parse(payload as string);
      expect(logged.category).toBe("network");
      expect(logged.status).toBeUndefined();
      expect(logged.requestId).toBeUndefined();
      expect(logged.message).toBe("ECONNRESET");

      consoleSpy.mockRestore();
    });

    it("never logs the API key or an Authorization header value, even when present on the error's headers", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const error = realHttpError(401, "authentication_error", "invalid x-api-key", "req_diagnostic_test");
      // Simulate credential material being present on the error object's
      // headers (as it might be on some transport-level errors) to prove
      // our logger never reaches into headers at all, only the documented
      // status/type/requestID/nested-message fields.
      (error as InstanceType<typeof Anthropic.APIError>).headers?.set("authorization", `Bearer ${SECRET_KEY}`);
      mockCreate.mockRejectedValue(error);
      const provider = new ClaudeRouterProvider();

      await expect(provider.decide({ prompt: SENSITIVE_PROMPT })).rejects.toThrow(ProviderAuthenticationError);

      const loggedText = consoleSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(loggedText).not.toContain(SECRET_KEY);
      expect(loggedText).not.toContain(SENSITIVE_PROMPT);
      // Distinctive phrase from the system prompt (routing-spec-v1 instructions)
      // — confirms the system/user prompt content itself is never logged.
      expect(loggedText).not.toContain("Select exactly one route");

      consoleSpy.mockRestore();
    });

    it("never logs a raw response body — only the extracted safe fields, even when the body has unexpected extra fields", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockCreate.mockRejectedValue(
        Anthropic.APIError.generate(
          400,
          {
            type: "error",
            error: { type: "invalid_request_error", message: "messages: roles must alternate" },
            request_id: "req_bad_request",
            // A field that should never appear in our log even though the
            // SDK still attaches the whole raw body to `error.error`.
            unexpected_internal_field: "should-not-be-logged",
          },
          undefined,
          new Headers({ "request-id": "req_bad_request" }),
        ),
      );
      const provider = new ClaudeRouterProvider();

      await expect(provider.decide({ prompt: SENSITIVE_PROMPT })).rejects.toThrow(ProviderRequestError);

      const [, payload] = consoleSpy.mock.calls[0];
      const logged = JSON.parse(payload as string);
      expect(Object.keys(logged).sort()).toEqual(
        ["category", "errorClass", "errorType", "latencyMs", "message", "provider", "requestId", "status"].sort(),
      );
      expect(logged.message).toBe("messages: roles must alternate");
      expect(payload).not.toContain("unexpected_internal_field");

      consoleSpy.mockRestore();
    });
  });

  it("does not bypass policy: identical route/action produces identical policy regardless of provider name", async () => {
    mockCreate.mockResolvedValue(toolUseResponse({ route: "JIRA" }));
    const provider = new ClaudeRouterProvider();
    const decision = await provider.decide({ prompt: "Create a Jira ticket for this timeout." });

    const derived = deriveAction(decision.route, "Create a Jira ticket for this timeout.");
    const policy = derived.action ? evaluatePolicy(derived.action) : undefined;

    expect(policy?.result).toBe("REQUIRE_REVIEW");
    expect(policy?.action).toBe("CREATE_JIRA");
  });
});
