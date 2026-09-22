export interface UsageStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  meanInputTokens?: number;
  meanOutputTokens?: number;
  sampleCount: number;
}

export interface UsageSample {
  inputTokens?: number;
  outputTokens?: number;
}

/** Kept per-provider by the caller for Hybrid — Jev and Claude usage are never merged into one blended count. */
export function computeUsageStats(samples: readonly UsageSample[]): UsageStats {
  const withUsage = samples.filter((s) => s.inputTokens !== undefined || s.outputTokens !== undefined);
  const totalInputTokens = withUsage.reduce((sum, s) => sum + (s.inputTokens ?? 0), 0);
  const totalOutputTokens = withUsage.reduce((sum, s) => sum + (s.outputTokens ?? 0), 0);

  return {
    totalInputTokens,
    totalOutputTokens,
    meanInputTokens: withUsage.length > 0 ? totalInputTokens / withUsage.length : undefined,
    meanOutputTokens: withUsage.length > 0 ? totalOutputTokens / withUsage.length : undefined,
    sampleCount: withUsage.length,
  };
}
