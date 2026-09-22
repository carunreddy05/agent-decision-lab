import { describe, expect, it } from "vitest";
import { hashPrompt } from "@/benchmark/prompt-hash";

describe("hashPrompt", () => {
  it("is deterministic for the exact same prompt text", () => {
    const prompt = "Find the pull request for the timeout fix.";
    expect(hashPrompt(prompt)).toBe(hashPrompt(prompt));
  });

  it("differs for different prompt text", () => {
    expect(hashPrompt("prompt A")).not.toBe(hashPrompt("prompt B"));
  });

  it("is sensitive to exact byte content, not normalized", () => {
    expect(hashPrompt("Prompt")).not.toBe(hashPrompt("prompt"));
    expect(hashPrompt("Prompt ")).not.toBe(hashPrompt("Prompt"));
  });

  it("produces a 64-character lowercase hex sha256 digest", () => {
    const hash = hashPrompt("anything");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
