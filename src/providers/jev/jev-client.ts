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
import { JEV_API_KEY_ENV_VAR, JEV_DEFAULT_TIMEOUT_MS, JEV_EVALUATE_PATH, JEV_GATEWAY_BASE_URL } from "./config";
import type { JevErrorBody, JevEvaluateRequest, JevEvaluateResponse } from "./jev-types";
import { isJevEvaluateResponse } from "./jev-types";

const PROVIDER_NAME = "jev";

/**
 * Permanent, minimal structured failure logging — hardened down from the
 * verbose temporary diagnostic added while investigating the Phase 4 smoke
 * -test 403 (see benchmark/reports/phase4-jev-research.md). Logs only what's
 * needed to diagnose a future failure without a repeat live call: category,
 * HTTP status if any, the provider's own safe error fields, and latency.
 * Never logs the API key, the Authorization header, request headers, or the
 * raw request/response body.
 */
function logProviderFailure(details: {
  category: string;
  status?: number;
  errorType?: string;
  message?: string;
  latencyMs?: number;
}): void {
  console.error("[jev-provider-failure]", JSON.stringify({ provider: PROVIDER_NAME, ...details }));
}

/**
 * No retry logic here, deliberately (Phase 4 instructions §13): a single
 * attempt per call keeps benchmark latency and failure counts honest. A
 * fixed retry policy could be added later, but only as a documented,
 * explicit choice — never silently, since it would change what "latency"
 * and "failure rate" mean in recorded benchmark results.
 */
export async function callJevEvaluate(
  request: JevEvaluateRequest,
  options: { timeoutMs?: number } = {},
): Promise<{ response: JevEvaluateResponse; latencyMs: number }> {
  const apiKey = process.env[JEV_API_KEY_ENV_VAR];
  if (!apiKey) {
    throw new ProviderAuthenticationError(
      PROVIDER_NAME,
      `Missing required environment variable ${JEV_API_KEY_ENV_VAR}.`,
    );
  }

  const timeoutMs = options.timeoutMs ?? JEV_DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const start = Date.now();
  let httpResponse: Response;
  try {
    httpResponse = await fetch(`${JEV_GATEWAY_BASE_URL}${JEV_EVALUATE_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ProviderTimeoutError(PROVIDER_NAME, "client");
    }
    // Genuine transport failure (DNS, TLS, connection refused/reset, etc.).
    // Not split into per-cause transport error types per Phase 4 instruction
    // §7 — ProviderUnavailableError remains the simplest accurate
    // representation unless a real need for finer granularity shows up.
    const name = error instanceof Error ? error.name : typeof error;
    const message = error instanceof Error ? error.message : undefined;
    logProviderFailure({ category: "network", message: `${name}${message ? `: ${message}` : ""}` });
    throw new ProviderUnavailableError(PROVIDER_NAME, error);
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = Date.now() - start;

  if (!httpResponse.ok) {
    throw await toProviderError(httpResponse, latencyMs);
  }

  const body: unknown = await httpResponse.json().catch((error: unknown) => {
    throw new InvalidProviderOutputError("Jev response body was not valid JSON.", error);
  });

  if (!isJevEvaluateResponse(body)) {
    throw new InvalidProviderOutputError("Jev response did not match the expected /v1/evaluate shape.", body);
  }

  return { response: body, latencyMs };
}

/**
 * Status-code mapping, hardened after a real Phase 4 smoke test hit an
 * undocumented, body-less HTTP 403 that this function's earlier version
 * silently folded into ProviderUnavailableError (see
 * benchmark/reports/phase4-jev-research.md for the incident). The guiding
 * distinction throughout: is this a rejected *request* (400/404/409/422 —
 * our adapter sent something the provider won't process at all, no
 * decision was ever attempted), an account-standing problem (401/402/403 —
 * distinguishable by *why* the account is in a bad state), a rate limit
 * (429), a timeout (504, alongside the client-side AbortError case), or a
 * genuine outage (5xx generally, and network transport failures above)?
 * None of these should be conflated with InvalidProviderOutputError, which
 * is reserved for a *successful* response with an unexpected body shape.
 */
async function toProviderError(httpResponse: Response, latencyMs: number): Promise<Error> {
  const body = (await httpResponse.json().catch(() => undefined)) as JevErrorBody | undefined;
  logProviderFailure({
    category: "http",
    status: httpResponse.status,
    errorType: body?.error_type,
    message: body?.message,
    latencyMs,
  });

  switch (httpResponse.status) {
    case 400:
    case 404:
    case 409:
    case 422:
      // All four mean "the request as sent was rejected" for different
      // reasons (malformed body, wrong path, a state conflict, or failed
      // validation) — none reach model evaluation, so none are an
      // InvalidProviderOutputError. Not split further: on a correctly-built
      // adapter these should be rare, and a finer breakdown isn't earning
      // its complexity yet.
      return new ProviderRequestError(
        PROVIDER_NAME,
        `HTTP ${httpResponse.status}: ${body?.message ?? "no message"}`,
      );
    case 401:
      return new ProviderAuthenticationError(PROVIDER_NAME, body);
    case 402:
      return new ProviderBillingError(PROVIDER_NAME, body);
    case 403:
      return new ProviderAuthorizationError(PROVIDER_NAME, body);
    case 429: {
      const retryAfterHeader = httpResponse.headers.get("Retry-After");
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
      return new ProviderRateLimitError(
        PROVIDER_NAME,
        Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
        body,
      );
    }
    case 504:
      // A server-reported upstream timeout, as distinct from our own
      // AbortController firing — both are "timeout," neither is
      // "uncertainty," so they share ProviderTimeoutError; `origin`
      // preserves which one actually happened.
      return new ProviderTimeoutError(PROVIDER_NAME, "upstream");
    case 529:
      return new ProviderUnavailableError(PROVIDER_NAME, body);
    default:
      return new ProviderUnavailableError(
        PROVIDER_NAME,
        `Unexpected HTTP ${httpResponse.status}: ${body?.message ?? "no message"}`,
      );
  }
}
