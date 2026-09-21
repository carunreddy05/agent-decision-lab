/**
 * Technical-failure error types a RouterProvider can throw. These are kept
 * distinct from "low confidence" because they represent a different
 * architectural event: uncertainty fallback vs. technical failure fallback
 * (see ADR-004). Callers should not conflate the two.
 */

export class ProviderTimeoutError extends Error {
  constructor(public readonly provider: string) {
    super(`${provider} timed out`);
    this.name = "ProviderTimeoutError";
  }
}

export class ProviderUnavailableError extends Error {
  constructor(
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(`${provider} is unavailable`);
    this.name = "ProviderUnavailableError";
  }
}

export class InvalidProviderOutputError extends Error {
  constructor(
    message: string,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = "InvalidProviderOutputError";
  }
}
