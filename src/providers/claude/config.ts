/**
 * Approved in Phase 5A research (benchmark/reports/phase5-claude-research.md).
 * `claude-sonnet-5` chosen as a defensible general-purpose baseline: capable
 * enough to be a fair comparison, far cheaper than Opus 5 (which would make
 * this a test against an unnecessarily powerful model), and not so cheap
 * (Haiku 4.5) that a loss to Jev could be dismissed as a strawman baseline.
 */
export const CLAUDE_MODEL_ID = "claude-sonnet-5";

/**
 * Anthropic's official env var name (not invented here) — the zero-arg SDK
 * client reads this automatically, but we check it ourselves first so a
 * missing key fails fast with no network attempt, matching the Jev adapter's
 * behavior.
 */
export const CLAUDE_API_KEY_ENV_VAR = "ANTHROPIC_API_KEY";

/**
 * Same timeout philosophy as the Jev adapter (config.ts:
 * JEV_DEFAULT_TIMEOUT_MS) — an explicit, short client timeout rather than
 * the SDK's 10-minute default, since a routing classification should return
 * in well under 10 seconds and a hung request should fail the benchmark
 * loudly, not silently eat minutes.
 */
export const CLAUDE_DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Explicit and zero, not the SDK's default of 2 — a benchmark's recorded
 * latency and failure counts must reflect exactly what happened on the one
 * attempt made, not an average smeared across silent retries (same
 * reasoning as the Jev adapter's `callJevEvaluate`).
 */
export const CLAUDE_MAX_RETRIES = 0;

/**
 * Current standard pricing for claude-sonnet-5, confirmed live against
 * claude.com/pricing during Phase 5A research (2026-09-22) — not the
 * skill's cached reference table alone. Versioned here, separate from the
 * calculation that uses it, so a historical benchmark artifact can record
 * exactly which pricing assumption produced its `estimatedCostUsd` values
 * even if this constant is later updated for a price change.
 */
export const CLAUDE_STANDARD_PRICE_PER_MILLION_INPUT_TOKENS_USD = 2.0;
export const CLAUDE_STANDARD_PRICE_PER_MILLION_OUTPUT_TOKENS_USD = 10.0;
export const CLAUDE_PRICING_SOURCE =
  "claude.com/pricing, claude-sonnet-5 standard rate, confirmed 2026-09-22";
