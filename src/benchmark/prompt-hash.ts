import { createHash } from "node:crypto";

/**
 * Deterministic hash of the exact, unnormalized UTF-8 prompt bytes — used so
 * case-result artifacts can reference a case's prompt (`promptHash`) without
 * persisting the raw prompt text itself (Phase 7A design checkpoint §8). The
 * locked dataset (`routing-v1.0.json`) remains the sole authoritative source
 * for recovering the prompt behind a `caseId`; this hash only lets a reader
 * detect a dataset/result mismatch.
 */
export function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt, "utf-8").digest("hex");
}
