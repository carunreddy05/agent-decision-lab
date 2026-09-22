/**
 * Access path: Vercel AI Gateway, `/v1/evaluate` — corrected during the
 * Phase 4 wire-format reconciliation (benchmark/reports/phase4-jev-research.md
 * §"Addendum: wire-format reconciliation"). The original Phase 4 research
 * approved the TypeSafe-compatible passthrough (`/typesafe/v1/systemone`)
 * with model `jev-1.13.0`; a follow-up documentation check found Vercel's
 * current guidance explicitly recommends `/v1/evaluate` for new
 * integrations ("the same capability without TypeSafe-specific naming") and
 * that `jev-1.13.0` is never used in any Gateway example — only
 * `typesafe-ai/jev` is. Both corrections are superseded here, not silently
 * — see the reconciliation report for the full analysis.
 */
export const JEV_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";
export const JEV_EVALUATE_PATH = "/v1/evaluate";

/**
 * Vercel's own catalog identifier for the Jev model line — confirmed as the
 * only identifier shown in every documented `/v1/evaluate` and AI Gateway
 * Models-catalog example. Unlike `jev-1.13.0` (TypeSafe's own direct-API
 * version string, not documented for this access path), this is NOT a
 * pinned version — see the reproducibility note on `RESOLVED_MODEL_NOTE`
 * below. Do not swap this for `jev-1.13.0`; that identifier is undocumented
 * for the Gateway and was not confirmed to work.
 */
export const JEV_MODEL_ID = "typesafe-ai/jev";

/**
 * Reproducibility limitation, recorded rather than papered over: the raw
 * HTTP Gateway response does not expose which concrete underlying Jev
 * build answered a request when addressed via the `typesafe-ai/jev`
 * catalog identifier — no field in `providerMetadata.gateway.routing`
 * resolves to a version number, unlike the alias-resolution behavior
 * documented for the separate `@ai-sdk` TypeSafe provider package (a
 * different, heavier access path this project does not use). Do not
 * attempt to infer a version from timestamps or other metadata.
 */
export const JEV_RESOLVED_MODEL_VERSION_NOTE =
  "Concrete underlying Jev version not exposed by the Vercel raw HTTP Gateway response.";

/**
 * The exact name Vercel's own documentation uses for this credential
 * (vercel.com/docs/ai-gateway/sdks-and-apis/typesafe) — not invented here.
 * Unchanged by the endpoint correction; the same Gateway credential works
 * for both `/v1/evaluate` and the TypeSafe-compatible path.
 */
export const JEV_API_KEY_ENV_VAR = "AI_GATEWAY_API_KEY";

/**
 * Matches TypeSafe's own documented Python SDK default
 * (docs.typesafe.ai/sdk/python/api/constants.md: 10.0s) rather than an
 * arbitrary number, so our default lines up with the vendor's own
 * assumption about what a normal request should take.
 */
export const JEV_DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Non-promotional, standard early-access rate — confirmed directly on the
 * current Vercel AI Gateway Models page for Jev (re-checked during the wire
 * -format reconciliation pass, 2026-09-21: "$0.042/1M input tokens").
 * Promotional free pricing (Vercel AI Gateway, through 2026-09-25) is
 * tracked separately and must never be substituted for this constant.
 */
export const JEV_STANDARD_PRICE_PER_MILLION_INPUT_TOKENS_USD = 0.042;
export const JEV_PRICING_SOURCE =
  "Vercel AI Gateway Models page (vercel.com/ai-gateway/models/jev), standard rate, confirmed 2026-09-21 — not the promotional rate";
