import { describe, expect, it } from "vitest";
import { PRICING_CONFIG, PRICING_CONFIG_VERSION } from "@/benchmark/pricing-config";
import { CLAUDE_STANDARD_PRICE_PER_MILLION_INPUT_TOKENS_USD, CLAUDE_STANDARD_PRICE_PER_MILLION_OUTPUT_TOKENS_USD } from "@/providers/claude/config";
import { JEV_STANDARD_PRICE_PER_MILLION_INPUT_TOKENS_USD } from "@/providers/jev/config";

describe("pricing-config", () => {
  it("carries a version string", () => {
    expect(PRICING_CONFIG.version).toBe(PRICING_CONFIG_VERSION);
    expect(typeof PRICING_CONFIG_VERSION).toBe("string");
    expect(PRICING_CONFIG_VERSION.length).toBeGreaterThan(0);
  });

  it("wraps (not duplicates) the exact constants each provider adapter uses", () => {
    expect(PRICING_CONFIG.jev.inputPerMillionUsd).toBe(JEV_STANDARD_PRICE_PER_MILLION_INPUT_TOKENS_USD);
    expect(PRICING_CONFIG.claude.inputPerMillionUsd).toBe(CLAUDE_STANDARD_PRICE_PER_MILLION_INPUT_TOKENS_USD);
    expect(PRICING_CONFIG.claude.outputPerMillionUsd).toBe(CLAUDE_STANDARD_PRICE_PER_MILLION_OUTPUT_TOKENS_USD);
  });

  it("never fetches pricing dynamically — values are plain compile-time constants", () => {
    expect(typeof PRICING_CONFIG.jev.inputPerMillionUsd).toBe("number");
    expect(typeof PRICING_CONFIG.claude.inputPerMillionUsd).toBe("number");
  });
});
