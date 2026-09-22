/**
 * Technical-failure error types a RouterProvider can throw. These are kept
 * distinct from "low confidence" because they represent a different
 * architectural event: uncertainty fallback vs. technical failure fallback
 * (see ADR-004). Callers should not conflate the two.
 *
 * The taxonomy below was hardened after a real Phase 4 Jev smoke test hit an
 * HTTP 403 that the original three-error model had no honest home for (see
 * benchmark/reports/phase4-jev-research.md). The guiding rule for adding a
 * new type here: only when an existing one would be *materially misleading*
 * about what happened or what a caller should do about it (retry vs. fix
 * config vs. give up) — not one type per HTTP status code.
 */

export class ProviderTimeoutError extends Error {
  /**
   * `origin` distinguishes a timeout **we** imposed (`"client"` — our own
   * AbortController fired) from one the **provider's own infrastructure**
   * reported (`"upstream"` — an HTTP 504 came back from the far end). Both
   * are "technical failure fallback," not "uncertainty fallback," so they
   * share one error class; `origin` exists only so logs/traces can tell
   * them apart, since the fix for each differs (raise our timeout budget vs.
   * nothing we control). Defaults to `"client"` since that's the original,
   * more common case (an AbortError never carries this distinction itself).
   */
  constructor(
    public readonly provider: string,
    public readonly origin: "client" | "upstream" = "client",
  ) {
    super(`${provider} timed out (${origin})`);
    this.name = "ProviderTimeoutError";
  }
}

/**
 * The provider (or the network path to it) is down or erroring in a way
 * that isn't one of the more specific categories below — a genuine
 * "unavailable," "try later" condition: 5xx responses, and raw
 * fetch/network failures (DNS, TLS, connection refused/reset). Not
 * over-engineered into per-cause transport error types for now (Phase 4
 * instruction: a dedicated transport error type can wait for an actual
 * need) — `cause` carries whatever detail is safely available.
 */
export class ProviderUnavailableError extends Error {
  constructor(
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(`${provider} is unavailable`);
    this.name = "ProviderUnavailableError";
  }
}

/**
 * A request was rejected because credentials were missing, malformed, or no
 * longer valid (HTTP 401). Deliberately distinct from ProviderUnavailableError:
 * an unavailable provider may resolve itself on retry, but bad credentials
 * will not — escalating or retrying does nothing until a human fixes
 * configuration. Identified as a gap during Phase 4 Jev research (neither
 * timeout, unavailable, nor invalid-output fit an HTTP 401).
 */
export class ProviderAuthenticationError extends Error {
  constructor(
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(`${provider} rejected the request: authentication failed`);
    this.name = "ProviderAuthenticationError";
  }
}

/**
 * Credentials are valid (this is not a 401), but the caller isn't permitted
 * to perform this specific request (HTTP 403) — a different fix than a bad
 * key: the *account/key* needs a permission or capability grant, not new
 * credentials. Added after a real Jev smoke test returned a bare 403 that
 * the original taxonomy silently folded into ProviderUnavailableError,
 * which wrongly implied "try again later" for something retrying can't fix.
 */
export class ProviderAuthorizationError extends Error {
  constructor(
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(`${provider} rejected the request: not authorized for this operation`);
    this.name = "ProviderAuthorizationError";
  }
}

/**
 * The request was rejected for an account/billing/quota reason (HTTP 402) —
 * e.g. no payment method on file, credits exhausted, a verification gate.
 * Deliberately named around what the *status code* means for our
 * integration, not a specific vendor reason we can't observe from the HTTP
 * response alone: we don't claim to know *which* billing condition applied,
 * only that this is an account-standing problem, not a transient outage,
 * bad credentials, or a permission scope issue.
 */
export class ProviderBillingError extends Error {
  constructor(
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(`${provider} rejected the request: billing or account verification required`);
    this.name = "ProviderBillingError";
  }
}

/**
 * The provider rejected the shape of *our own outbound request*
 * (400/404/409/422) — this is categorically different from
 * InvalidProviderOutputError, which is for a *successful* response whose
 * body doesn't match what we expected. A ProviderRequestError means the
 * provider never got far enough to produce a decision at all; it's telling
 * us our adapter sent something it doesn't accept (wrong field, wrong path,
 * a conflicting resource state). The fix lives in our request-construction
 * code, not in response parsing. 404/409 are folded in here rather than
 * given their own types: both still mean "the request as sent was
 * rejected," just for different reasons (wrong URL vs. a state conflict) —
 * neither is common enough on a well-built adapter to warrant a distinct
 * category yet.
 */
export class ProviderRequestError extends Error {
  constructor(
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(`${provider} rejected our request as invalid`);
    this.name = "ProviderRequestError";
  }
}

/**
 * A *successful* response (2xx) whose body doesn't match the shape we
 * expect — malformed or unrecognized output, not a rejected request. Kept
 * strictly separate from ProviderRequestError (see above): this is a
 * provider-output problem, not an our-request problem, and conflating them
 * would hide which side of the exchange actually broke.
 */
export class InvalidProviderOutputError extends Error {
  constructor(
    message: string,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = "InvalidProviderOutputError";
  }
}

/**
 * The provider is reachable and responding, but this request was throttled
 * (HTTP 429). Distinct from ProviderUnavailableError (the service isn't
 * down) and from ProviderAuthenticationError (credentials are fine) —
 * whether retrying helps depends on `retryAfterMs`, which callers should
 * use rather than retrying immediately. Identified as the same Phase 4 gap
 * as ProviderAuthenticationError, for HTTP 429.
 */
export class ProviderRateLimitError extends Error {
  constructor(
    public readonly provider: string,
    public readonly retryAfterMs?: number,
    public readonly cause?: unknown,
  ) {
    super(`${provider} rate-limited the request`);
    this.name = "ProviderRateLimitError";
  }
}
