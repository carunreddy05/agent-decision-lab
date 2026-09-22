# ADR-004: Confidence Is Not Correctness, and Uncertainty Fallback Is Not Technical Failure

## Status

Accepted (Phase 1, extended Phase 6). Referenced in
`src/domain/route.ts`, `src/domain/trace.ts`, `src/domain/errors.ts`,
`src/pipeline/run-decision.ts`.

## Context

A confidence-gated fallback strategy needs to distinguish several
different reasons a provider's initial decision might not be trusted
as-is, and needs to avoid two specific mistakes: (1) treating a model's
self-reported confidence as if it were a measured probability of being
correct, and (2) collapsing distinct failure reasons (the model is
uncertain vs. the model literally didn't respond) into one boolean.

## Decision

- `RoutingDecision.confidence`/`.probabilities` are documented as
  **provider-reported values**, never described as calibrated
  probabilities of correctness unless a calibration study has actually
  been run. None has been run in this project; every report says so
  explicitly (see `benchmark/reports/phase8d-threshold-analysis.md` §F).
- `EscalationReason` (`src/domain/trace.ts`) is a tagged enum with
  distinct values for distinct architectural events, never merged into a
  single "did it fail" flag:
  - `UNCERTAINTY_FALLBACK` — the provider returned a valid decision, but
    its confidence fell below the configured threshold.
  - `MISSING_CONFIDENCE_FALLBACK` — the provider returned a valid
    decision with **no** confidence signal at all. This is deliberately
    distinct from treating a missing value as `0`: "the model didn't
    report a certainty" and "the model confidently reported low
    certainty" are different events.
  - `TECHNICAL_FAILURE_FALLBACK` — the provider threw
    (`ProviderTimeoutError`, `ProviderRateLimitError`,
    `ProviderUnavailableError`); no decision was ever produced.
- `decideHybrid()` (`src/strategy/hybrid-routing-strategy.ts`) only
  treats the transient/runtime error categories above as fallback-
  eligible. Account/config/contract errors
  (`ProviderAuthenticationError`, `ProviderAuthorizationError`,
  `ProviderBillingError`, `ProviderRequestError`,
  `InvalidProviderOutputError`) fail fast instead — silently falling back
  on these would make a broken credential or a malformed request look
  like a healthy Claude-only run.

## Consequences

- The benchmark's high-confidence-error analysis
  (`benchmark/reports/phase8d-threshold-analysis.md`) exists specifically
  because confidence and correctness were never assumed to be the same
  thing: two Jev decisions at ≥0.90 confidence (RC-048 at 0.99, RC-049 at
  0.94) were wrong, and one (RC-048) never escalates under any of the
  five thresholds tested, because its confidence exceeds the highest one
  tried.
- The Hybrid strategy's fallback is an **escalation** mechanism, not a
  verification mechanism — Claude is asked the original question fresh,
  with no visibility into Jev's route, confidence, or that Jev was
  consulted at all. It has no way to "check" Jev's answer, only to answer
  independently. This distinction turned out to matter empirically: on
  RC-048 and RC-049, Claude's independent answer agreed with Jev's wrong
  one, so escalation alone did not repair either case (see
  `phase9-architectural-analysis.md` §6).
