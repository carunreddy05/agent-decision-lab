import {
  CLAUDE_MODEL_ID,
  CLAUDE_PRICING_SOURCE,
  CLAUDE_STANDARD_PRICE_PER_MILLION_INPUT_TOKENS_USD,
  CLAUDE_STANDARD_PRICE_PER_MILLION_OUTPUT_TOKENS_USD,
} from "@/providers/claude/config";
import { JEV_PRICING_SOURCE, JEV_STANDARD_PRICE_PER_MILLION_INPUT_TOKENS_USD } from "@/providers/jev/config";

/**
 * A thin, versioned wrapper around the pricing constants each provider
 * adapter already uses to compute `estimatedCostUsd` at decide-time — not a
 * parallel set of numbers that could drift from what actually produced a
 * decision's cost (Phase 7A design checkpoint §5). This config never
 * recomputes cost from tokens x price itself for a case result; it exists
 * for provenance (recording which pricing assumption was active on a run)
 * and for aggregate sums of already-computed per-case costs.
 *
 * Static and versioned on purpose: never fetched live (CLAUDE.md cost-safety
 * guardrail), and a future price change creates a new version string rather
 * than editing this one in place, mirroring the dataset-versioning
 * discipline already established for routing-v1.0.json.
 */
export const PRICING_CONFIG_VERSION = "pricing-v1-2026-09-22";

export const PRICING_CONFIG = {
  version: PRICING_CONFIG_VERSION,
  jev: {
    inputPerMillionUsd: JEV_STANDARD_PRICE_PER_MILLION_INPUT_TOKENS_USD,
    outputPerMillionUsd: 0,
    source: JEV_PRICING_SOURCE,
  },
  claude: {
    model: CLAUDE_MODEL_ID,
    inputPerMillionUsd: CLAUDE_STANDARD_PRICE_PER_MILLION_INPUT_TOKENS_USD,
    outputPerMillionUsd: CLAUDE_STANDARD_PRICE_PER_MILLION_OUTPUT_TOKENS_USD,
    source: CLAUDE_PRICING_SOURCE,
  },
} as const;
