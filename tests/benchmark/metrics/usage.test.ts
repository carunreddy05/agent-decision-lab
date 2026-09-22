import { describe, expect, it } from "vitest";
import { computeUsageStats } from "@/benchmark/metrics/usage";

describe("computeUsageStats", () => {
  it("sums and means input/output tokens across samples", () => {
    const stats = computeUsageStats([
      { inputTokens: 100, outputTokens: 10 },
      { inputTokens: 200, outputTokens: 20 },
    ]);
    expect(stats.totalInputTokens).toBe(300);
    expect(stats.totalOutputTokens).toBe(30);
    expect(stats.meanInputTokens).toBe(150);
    expect(stats.meanOutputTokens).toBe(15);
    expect(stats.sampleCount).toBe(2);
  });

  it("excludes samples with no usage at all from the sample count", () => {
    const stats = computeUsageStats([{ inputTokens: 100, outputTokens: 10 }, {}]);
    expect(stats.sampleCount).toBe(1);
  });

  it("returns undefined means (not NaN) for no usable samples", () => {
    const stats = computeUsageStats([]);
    expect(stats.meanInputTokens).toBeUndefined();
    expect(stats.meanOutputTokens).toBeUndefined();
  });
});
