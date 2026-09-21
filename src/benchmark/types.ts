import type { Action } from "@/domain/action";
import type { PolicyResult } from "@/domain/policy";
import type { Route } from "@/domain/route";

/**
 * CLEAR: a competent human identifies the primary route almost immediately.
 * MODERATE: requires understanding intent beyond obvious keywords, or
 * involves cross-system context.
 * AMBIGUOUS: multiple routes are genuinely defensible without more context —
 * not merely a case the mock router happens to get wrong.
 */
export type BenchmarkDifficulty = "CLEAR" | "MODERATE" | "AMBIGUOUS";

/**
 * A single hand-labeled routing benchmark case. `expectedAction` and
 * `expectedPolicy` are omitted (not `null`) when they don't make semantic
 * sense for the case — e.g. DIRECT_ANSWER, an unsupported REJECT with no
 * proposed action, or a genuinely multi-intent case where forcing one action
 * would misrepresent the request. See ADR-006 / phase3-review.md.
 */
export interface BenchmarkCase {
  id: string;
  prompt: string;
  expectedRoute: Route;
  expectedAction?: Action;
  expectedPolicy?: PolicyResult;
  difficulty: BenchmarkDifficulty;
  category: string;
  notes?: string;
}

/**
 * `version` must carry a "-draft" suffix until the labels are human-approved
 * (see Phase 3 gate). Once approved, later corrections get a new version and
 * a recorded reason — labels are never silently edited in place.
 */
export interface BenchmarkDataset {
  version: string;
  createdAt: string;
  description: string;
  cases: BenchmarkCase[];
}
