import Anthropic from "@anthropic-ai/sdk";
import { ROUTES, type RoutingDecision, type RoutingRequest } from "@/domain/route";
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
import { assertValidRoutingDecision, isRoute } from "@/domain/validate";
import type { RouterProvider } from "../router-provider";
import { ROUTING_INSTRUCTIONS, ROUTING_SPEC_VERSION, renderRouteCriteriaList } from "../routing-spec";
import {
  CLAUDE_API_KEY_ENV_VAR,
  CLAUDE_DEFAULT_TIMEOUT_MS,
  CLAUDE_MAX_RETRIES,
  CLAUDE_MODEL_ID,
  CLAUDE_PRICING_SOURCE,
  CLAUDE_STANDARD_PRICE_PER_MILLION_INPUT_TOKENS_USD,
  CLAUDE_STANDARD_PRICE_PER_MILLION_OUTPUT_TOKENS_USD,
} from "./config";

const PROVIDER_NAME = "claude";
const ROUTE_TOOL_NAME = "select_route";

// Deliberately not type-annotated as `Anthropic.Tool` — that exported type
// is the older custom-tool shape and doesn't list `strict`; structural
// typing against `messages.create()`'s own `tools` parameter is what
// actually validates this object, per the SDK's documented pattern for
// strict tool use (skill: "Don't type-annotate as Tool[] — let structural
// typing infer").
const ROUTE_TOOL = {
  name: ROUTE_TOOL_NAME,
  description: "Select exactly one supported route for this developer-support request.",
  // Guarantees tool_use.input validates exactly against input_schema — a
  // sixth value or a malformed shape is structurally impossible, not just
  // discouraged by prompt wording. See phase5-claude-research.md §6.
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      route: { type: "string" as const, enum: [...ROUTES] },
    },
    required: ["route"],
    additionalProperties: false,
  },
};

function buildSystemPrompt(): string {
  return [
    ROUTING_INSTRUCTIONS,
    "",
    "Routes:",
    renderRouteCriteriaList(),
    "",
    `Call the ${ROUTE_TOOL_NAME} tool with exactly one route.`,
  ].join("\n");
}

/**
 * Normalizes Claude, constrained to a single forced tool call, into a
 * RoutingDecision — the general-purpose-LLM counterpart to
 * JevRouterProvider, both approved in Phase 5 (see
 * benchmark/reports/phase5-claude-research.md). All Anthropic SDK types
 * stay inside `src/providers/claude/`.
 *
 * Deliberately reports no confidence/probabilities signal: nothing here
 * asks Claude to self-report certainty, derives a number from wording, or
 * reads token log-probabilities. `RoutingDecision.confidence` and
 * `.probabilities` are simply left `undefined` — a real, valid state the
 * domain type and `evaluateEscalation` already support, not a workaround.
 * This asymmetry with Jev (which does report a native decision signal) is
 * the experimental question Phase 6 exists to explore, not a bug to paper
 * over with a fabricated number.
 */
export class ClaudeRouterProvider implements RouterProvider {
  readonly name = PROVIDER_NAME;

  constructor(private readonly timeoutMs: number = CLAUDE_DEFAULT_TIMEOUT_MS) {}

  async decide(request: RoutingRequest): Promise<RoutingDecision> {
    const apiKey = process.env[CLAUDE_API_KEY_ENV_VAR];
    if (!apiKey) {
      throw new ProviderAuthenticationError(
        PROVIDER_NAME,
        `Missing required environment variable ${CLAUDE_API_KEY_ENV_VAR}.`,
      );
    }

    const client = new Anthropic({ apiKey });
    const start = Date.now();
    let response: Anthropic.Message;
    try {
      response = await client.messages.create(
        {
          model: CLAUDE_MODEL_ID,
          max_tokens: 128,
          // Explicitly disabled, not omitted: omitting `thinking` runs
          // Sonnet 5's adaptive thinking by default, which would add
          // latency and billed reasoning tokens to a bounded classification
          // task and would risk storing hidden reasoning we never asked
          // for. No temperature/top_p/top_k set, per Phase 5 approval.
          thinking: { type: "disabled" },
          system: buildSystemPrompt(),
          tools: [ROUTE_TOOL],
          tool_choice: { type: "tool", name: ROUTE_TOOL_NAME },
          messages: [{ role: "user", content: request.prompt }],
        },
        { timeout: this.timeoutMs, maxRetries: CLAUDE_MAX_RETRIES },
      );
    } catch (error) {
      throw toProviderError(error, Date.now() - start);
    }
    const latencyMs = Date.now() - start;

    const routeValue = extractRoute(response);

    const estimatedCostUsd =
      (response.usage.input_tokens * CLAUDE_STANDARD_PRICE_PER_MILLION_INPUT_TOKENS_USD +
        response.usage.output_tokens * CLAUDE_STANDARD_PRICE_PER_MILLION_OUTPUT_TOKENS_USD) /
      1_000_000;

    const candidate: RoutingDecision = {
      route: routeValue,
      provider: this.name,
      model: response.model,
      // confidence / probabilities intentionally omitted — see class doc.
      latencyMs,
      routingSpecVersion: ROUTING_SPEC_VERSION,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        estimatedCostUsd,
        // providerReportedCostUsd intentionally omitted — the Messages API
        // does not return a dollar-cost field, unlike Jev's Vercel Gateway
        // response. Not fabricated; see phase5-claude-research.md §14.
      },
      rawMetadata: {
        estimatedCostPricingSource: CLAUDE_PRICING_SOURCE,
        requestedModelIdentifier: CLAUDE_MODEL_ID,
        // Recorded explicitly as null, not omitted — Anthropic's current-
        // generation model IDs (e.g. claude-sonnet-5) do not expose a
        // separate dated/pinned version through the Messages API. Same
        // reproducibility-disclosure pattern as Jev's resolvedModelIdentifier.
        resolvedModelIdentifier: null,
        modelVersionResolution:
          "Anthropic's current-generation model IDs do not expose a separate dated/pinned version through the Messages API.",
        requestId: response.id,
      },
    };

    return assertValidRoutingDecision(candidate);
  }
}

function extractRoute(response: Anthropic.Message): RoutingDecision["route"] {
  if (response.stop_reason === "refusal") {
    throw new InvalidProviderOutputError(
      "Claude declined to answer (stop_reason: refusal); no route was produced.",
      response,
    );
  }
  if (response.stop_reason === "max_tokens") {
    throw new InvalidProviderOutputError(
      "Claude's tool call was truncated (stop_reason: max_tokens).",
      response,
    );
  }
  if (response.stop_reason !== "tool_use") {
    throw new InvalidProviderOutputError(`Unexpected stop_reason: "${String(response.stop_reason)}".`, response);
  }

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === ROUTE_TOOL_NAME,
  );
  if (!toolUseBlock) {
    throw new InvalidProviderOutputError(`Claude response is missing a "${ROUTE_TOOL_NAME}" tool call.`, response);
  }

  const input = toolUseBlock.input;
  const routeValue =
    typeof input === "object" && input !== null && "route" in input
      ? (input as Record<string, unknown>).route
      : undefined;

  if (typeof routeValue !== "string" || !isRoute(routeValue)) {
    throw new InvalidProviderOutputError(
      `Claude's tool call did not return a recognized route: ${JSON.stringify(input)}.`,
      response,
    );
  }

  return routeValue;
}

/**
 * Permanent, minimal structured failure logging — the Claude-side
 * counterpart to the Jev adapter's `[jev-provider-failure]` logger, added
 * after the first live Claude smoke test failed with no diagnosable detail
 * (see benchmark/reports/phase5-claude-research.md and the Phase 5C
 * checkpoint). Every field is read from documented, source-verified
 * properties of `Anthropic.APIError` (node_modules/@anthropic-ai/sdk/core/error.js):
 * `status`, `type`, `requestID` (from the `request-id` response header).
 * `error.constructor.name` is used for the SDK class name since these
 * classes never set `.name` explicitly (verified empirically — it inherits
 * the generic "Error").
 *
 * `message` is deliberately **not** `error.message`. Tracing the real SDK's
 * `APIError.makeMessage()` (core/error.js) against Anthropic's own
 * documented error envelope (`{type, error: {type, message}, request_id}`)
 * shows `error.message` is built from `JSON.stringify(error)` whenever the
 * envelope has no *top-level* `.message` — which real Anthropic error
 * bodies never do, since their message lives nested at `.error.message`.
 * Confirmed empirically via `Anthropic.APIError.generate()`, the exact path
 * a real request failure takes: `error.message` came back as the *entire
 * raw response body*, JSON-stringified. Logging that would violate "never
 * log raw response bodies." `extractSafeMessage` instead reaches into the
 * one documented-safe string at `error.error.error.message` for genuine
 * HTTP errors, and falls back to the top-level `.message` only for
 * network-level errors (`APIConnectionError` and friends), whose
 * constructors pass a plain string with no response body at all.
 */
function extractSafeMessage(error: unknown, hasHttpStatus: boolean): string | undefined {
  if (hasHttpStatus && error instanceof Anthropic.APIError) {
    const nested = (error.error as { error?: { message?: unknown } } | null | undefined)?.error?.message;
    return typeof nested === "string" ? nested : undefined;
  }
  return error instanceof Error ? error.message : undefined;
}

function logClaudeFailureDiagnostic(error: unknown, latencyMs: number): void {
  const isApiError = error instanceof Anthropic.APIError;
  // APIConnectionError (and its APIConnectionTimeoutError subclass) extend
  // APIError but always carry `status: undefined` — a real HTTP status is
  // what actually distinguishes "the server responded with an error" from
  // "no response was ever received."
  const hasHttpStatus = isApiError && typeof error.status === "number";
  console.error(
    "[claude-provider-failure]",
    JSON.stringify({
      provider: PROVIDER_NAME,
      category: hasHttpStatus ? "http" : isApiError ? "network" : "unknown",
      errorClass: error instanceof Error ? error.constructor.name : typeof error,
      status: hasHttpStatus ? error.status : undefined,
      errorType: isApiError ? error.type : undefined,
      message: extractSafeMessage(error, hasHttpStatus),
      requestId: isApiError ? error.requestID : undefined,
      latencyMs,
    }),
  );
}

/**
 * Status-code mapping onto the provider-neutral taxonomy finished in Phase
 * 4 — reused as-is, no Claude-specific error types. Ordering matters:
 * APIConnectionTimeoutError extends APIConnectionError, which extends
 * APIError, so each must be checked before its more general parent.
 * Anthropic's error taxonomy has no dedicated exception class for 402 or
 * 413 (see shared/error-codes.md in the claude-api skill) — both fall
 * through to the base APIError and are distinguished by `.status`.
 */
function toProviderError(error: unknown, latencyMs: number): Error {
  logClaudeFailureDiagnostic(error, latencyMs);

  if (error instanceof Anthropic.AuthenticationError) {
    return new ProviderAuthenticationError(PROVIDER_NAME, error);
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new ProviderAuthorizationError(PROVIDER_NAME, error);
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new ProviderRequestError(PROVIDER_NAME, error);
  }
  if (error instanceof Anthropic.RateLimitError) {
    const retryAfterHeader = error.headers?.get?.("retry-after");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
    return new ProviderRateLimitError(PROVIDER_NAME, Number.isFinite(retryAfterMs) ? retryAfterMs : undefined, error);
  }
  if (error instanceof Anthropic.UnprocessableEntityError) {
    return new ProviderRequestError(PROVIDER_NAME, error);
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new ProviderRequestError(PROVIDER_NAME, error);
  }
  if (error instanceof Anthropic.ConflictError) {
    return new ProviderRequestError(PROVIDER_NAME, error);
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderTimeoutError(PROVIDER_NAME, "client");
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderUnavailableError(PROVIDER_NAME, error);
  }
  if (error instanceof Anthropic.InternalServerError) {
    return new ProviderUnavailableError(PROVIDER_NAME, error);
  }
  if (error instanceof Anthropic.APIError) {
    // No dedicated exception subclass exists for 402 or 413 in this SDK
    // (confirmed against node_modules/@anthropic-ai/sdk/core/error.d.ts) —
    // both fall through to the base APIError and are distinguished by
    // `.status`.
    if (error.status === 402) {
      return new ProviderBillingError(PROVIDER_NAME, error);
    }
    if (error.status === 413) {
      return new ProviderRequestError(PROVIDER_NAME, error);
    }
    return new ProviderUnavailableError(PROVIDER_NAME, error);
  }
  return new ProviderUnavailableError(PROVIDER_NAME, error);
}
