import { ROUTES, type Route } from "@/domain/route";
import type { BenchmarkDifficulty } from "../types";

export interface AccuracyBreakdown {
  total: number;
  correct: number;
  accuracy: number;
}

const DIFFICULTIES: readonly BenchmarkDifficulty[] = ["CLEAR", "MODERATE", "AMBIGUOUS"];

export interface RouteAccuracySummary {
  overall: AccuracyBreakdown;
  byRoute: Record<Route, AccuracyBreakdown>;
  byDifficulty: Record<BenchmarkDifficulty, AccuracyBreakdown>;
  byCategory: Record<string, AccuracyBreakdown>;
  /** A failed case counts as not-correct in every accuracy above (Phase 7A §6/§15) — reported separately here. */
  failureCount: number;
  failureRate: number;
}

export interface RouteAccuracyInput {
  expectedRoute: Route;
  succeeded: boolean;
  /** Whether the observed route matched expectedRoute; ignored (treated as not-correct) when !succeeded. */
  correct?: boolean;
  difficulty: BenchmarkDifficulty;
  category: string;
}

function emptyBreakdown(): AccuracyBreakdown {
  return { total: 0, correct: 0, accuracy: 0 };
}

function accumulate(breakdown: AccuracyBreakdown, isCorrect: boolean): AccuracyBreakdown {
  const total = breakdown.total + 1;
  const correct = breakdown.correct + (isCorrect ? 1 : 0);
  return { total, correct, accuracy: correct / total };
}

/**
 * A failed case (provider threw) is scored as not-correct in every
 * denominator here, never dropped — see Phase 7A design checkpoint §6/§15.
 * `failureCount`/`failureRate` are always reported alongside so "the
 * provider was wrong" stays distinguishable from "the provider produced no
 * answer at all."
 */
export function computeRouteAccuracy(results: readonly RouteAccuracyInput[]): RouteAccuracySummary {
  let overall = emptyBreakdown();
  const byRoute = Object.fromEntries(ROUTES.map((route) => [route, emptyBreakdown()])) as Record<Route, AccuracyBreakdown>;
  const byDifficulty = Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, emptyBreakdown()])) as Record<
    BenchmarkDifficulty,
    AccuracyBreakdown
  >;
  const byCategory: Record<string, AccuracyBreakdown> = {};
  let failureCount = 0;

  for (const result of results) {
    const isCorrect = result.succeeded && result.correct === true;
    if (!result.succeeded) failureCount += 1;

    overall = accumulate(overall, isCorrect);
    byRoute[result.expectedRoute] = accumulate(byRoute[result.expectedRoute], isCorrect);
    byDifficulty[result.difficulty] = accumulate(byDifficulty[result.difficulty], isCorrect);
    byCategory[result.category] = accumulate(byCategory[result.category] ?? emptyBreakdown(), isCorrect);
  }

  return {
    overall,
    byRoute,
    byDifficulty,
    byCategory,
    failureCount,
    failureRate: results.length > 0 ? failureCount / results.length : 0,
  };
}

export interface LayerAccuracySummary {
  annotatedCount: number;
  correctCount: number;
  accuracy: number;
}

/**
 * Action/policy accuracy over only the cases annotated with an expected
 * value — kept fully independent of route accuracy (Phase 7A §11): a
 * `deriveAction` limitation never retroactively becomes a routing failure.
 */
export function computeLayerAccuracy(
  results: readonly { annotated: boolean; correct?: boolean }[],
): LayerAccuracySummary {
  const annotated = results.filter((r) => r.annotated);
  const correctCount = annotated.filter((r) => r.correct === true).length;
  return {
    annotatedCount: annotated.length,
    correctCount,
    accuracy: annotated.length > 0 ? correctCount / annotated.length : 0,
  };
}
