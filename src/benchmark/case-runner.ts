import type { Action } from "@/domain/action";
import type { PolicyResult } from "@/domain/policy";
import type { Route } from "@/domain/route";
import { HybridFallbackFailedError, ProviderRateLimitError } from "@/domain/errors";
import { assertValidRoutingDecision } from "@/domain/validate";
import { evaluatePolicy } from "@/policy/policy-engine";
import { deriveAction } from "@/pipeline/derive-action";
import type { RouterProvider } from "@/providers/router-provider";
import { decideHybrid } from "@/strategy/hybrid-routing-strategy";
import { hashPrompt } from "./prompt-hash";
import { BENCHMARK_SCHEMA_VERSION, type ClaudeOnlyCaseResult, type HybridCaseResult, type JevOnlyCaseResult } from "./result-types";
import type { BenchmarkCase } from "./types";

/** Shared run-level provenance, passed in once rather than re-derived per case. */
export interface CaseRunnerContext {
  benchmarkRunId: string;
  gitCommit: string;
  datasetVersion: string;
  datasetHash: string;
  routingSpecVersion: string;
}

function errorCategoryOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

/**
 * Safe, observability-only propagation of the provider's own `Retry-After`
 * value (Phase 8C-B) — undefined whenever the error isn't a rate limit, or
 * when the provider didn't supply one; never fabricated as 0. Nothing
 * reads this to drive retry/backoff behavior.
 */
function retryAfterMsOf(error: unknown): number | undefined {
  return error instanceof ProviderRateLimitError ? error.retryAfterMs : undefined;
}

function baseFields(benchCase: BenchmarkCase, ctx: CaseRunnerContext) {
  return {
    benchmarkRunId: ctx.benchmarkRunId,
    benchmarkSchemaVersion: BENCHMARK_SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    gitCommit: ctx.gitCommit,
    datasetVersion: ctx.datasetVersion,
    datasetHash: ctx.datasetHash,
    routingSpecVersion: ctx.routingSpecVersion,
    caseId: benchCase.id,
    promptHash: hashPrompt(benchCase.prompt),
    expectedRoute: benchCase.expectedRoute,
    expectedAction: benchCase.expectedAction,
    expectedPolicy: benchCase.expectedPolicy,
    difficulty: benchCase.difficulty,
    category: benchCase.category,
  };
}

interface ScoredActionPolicy {
  derivedAction?: Action;
  actionCorrect?: boolean;
  policyResult?: PolicyResult;
  policyCorrect?: boolean;
}

/**
 * Feeds a strategy's *final* route into the unchanged `deriveAction`/
 * `evaluatePolicy` — route, action, and policy accuracy stay three
 * independent measurements (Phase 7A design checkpoint §11): a
 * `deriveAction` limitation never retroactively becomes a routing failure,
 * and a policy mismatch never becomes a model failure.
 */
function scoreActionAndPolicy(
  route: Route,
  prompt: string,
  expectedAction: Action | undefined,
  expectedPolicy: PolicyResult | undefined,
): ScoredActionPolicy {
  const derived = deriveAction(route, prompt);
  const derivedAction = derived.action ?? undefined;
  const policyResult = derivedAction ? evaluatePolicy(derivedAction).result : undefined;
  return {
    derivedAction,
    actionCorrect: expectedAction !== undefined ? derivedAction === expectedAction : undefined,
    policyResult,
    policyCorrect: expectedPolicy !== undefined ? policyResult === expectedPolicy : undefined,
  };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function resolvedModelIdentifierOf(rawMetadata: Record<string, string | number | boolean | null> | undefined): string | null | undefined {
  const value = rawMetadata?.resolvedModelIdentifier;
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

export async function runJevOnlyCase(
  benchCase: BenchmarkCase,
  provider: RouterProvider,
  ctx: CaseRunnerContext,
): Promise<JevOnlyCaseResult> {
  const base = baseFields(benchCase, ctx);

  try {
    const decision = assertValidRoutingDecision(await provider.decide({ prompt: benchCase.prompt }));
    const scored = scoreActionAndPolicy(decision.route, benchCase.prompt, benchCase.expectedAction, benchCase.expectedPolicy);

    return {
      ...base,
      strategy: "JEV_ONLY",
      succeeded: true,
      route: decision.route,
      correctRoute: decision.route === benchCase.expectedRoute,
      confidence: decision.confidence,
      probabilities: decision.probabilities,
      latencyMs: decision.latencyMs,
      inputTokens: decision.usage?.inputTokens,
      outputTokens: decision.usage?.outputTokens,
      estimatedCostUsd: decision.usage?.estimatedCostUsd,
      providerReportedCostUsd: decision.usage?.providerReportedCostUsd,
      requestedModelIdentifier: stringOrUndefined(decision.rawMetadata?.requestedModelIdentifier),
      resolvedModelIdentifier: resolvedModelIdentifierOf(decision.rawMetadata),
      ...scored,
    };
  } catch (error) {
    return {
      ...base,
      strategy: "JEV_ONLY",
      succeeded: false,
      errorCategory: errorCategoryOf(error),
      retryAfterMs: retryAfterMsOf(error),
    };
  }
}

export async function runClaudeOnlyCase(
  benchCase: BenchmarkCase,
  provider: RouterProvider,
  ctx: CaseRunnerContext,
): Promise<ClaudeOnlyCaseResult> {
  const base = baseFields(benchCase, ctx);

  try {
    const decision = assertValidRoutingDecision(await provider.decide({ prompt: benchCase.prompt }));
    const scored = scoreActionAndPolicy(decision.route, benchCase.prompt, benchCase.expectedAction, benchCase.expectedPolicy);

    return {
      ...base,
      strategy: "CLAUDE_ONLY",
      succeeded: true,
      route: decision.route,
      correctRoute: decision.route === benchCase.expectedRoute,
      latencyMs: decision.latencyMs,
      inputTokens: decision.usage?.inputTokens,
      outputTokens: decision.usage?.outputTokens,
      estimatedCostUsd: decision.usage?.estimatedCostUsd,
      providerReportedCostUsd: decision.usage?.providerReportedCostUsd,
      requestedModelIdentifier: stringOrUndefined(decision.rawMetadata?.requestedModelIdentifier),
      resolvedModelIdentifier: resolvedModelIdentifierOf(decision.rawMetadata),
      ...scored,
    };
  } catch (error) {
    return {
      ...base,
      strategy: "CLAUDE_ONLY",
      succeeded: false,
      errorCategory: errorCategoryOf(error),
      retryAfterMs: retryAfterMsOf(error),
    };
  }
}

export async function runHybridCase(
  benchCase: BenchmarkCase,
  jevProvider: RouterProvider,
  claudeProvider: RouterProvider,
  threshold: number,
  ctx: CaseRunnerContext,
): Promise<HybridCaseResult> {
  const base = baseFields(benchCase, ctx);

  try {
    const result = await decideHybrid(
      { prompt: benchCase.prompt },
      { jevProvider, claudeProvider, confidenceThreshold: threshold },
    );

    const finalRoute = result.finalDecision.route;
    const finalCorrect = finalRoute === benchCase.expectedRoute;
    const initialJevCorrect = result.initialDecision ? result.initialDecision.route === benchCase.expectedRoute : undefined;
    const claudeCorrect = result.claudeDecision ? result.claudeDecision.route === benchCase.expectedRoute : undefined;
    const claudeCalled = result.claudeDecision !== undefined;
    const scored = scoreActionAndPolicy(finalRoute, benchCase.prompt, benchCase.expectedAction, benchCase.expectedPolicy);

    return {
      ...base,
      strategy: "HYBRID",
      threshold,
      succeeded: true,
      initialJevRoute: result.initialDecision?.route,
      initialJevCorrect,
      initialJevConfidence: result.initialDecision?.confidence,
      initialJevProbabilities: result.initialDecision?.probabilities,
      jevLatencyMs: result.initialDecision?.latencyMs ?? result.hybridMeta.initialAttemptLatencyMs,
      jevInputTokens: result.initialDecision?.usage?.inputTokens,
      jevOutputTokens: result.initialDecision?.usage?.outputTokens,
      jevEstimatedCostUsd: result.initialDecision?.usage?.estimatedCostUsd,
      jevProviderReportedCostUsd: result.initialDecision?.usage?.providerReportedCostUsd,
      initialErrorCategory: result.hybridMeta.initialErrorCategory,
      fallbackTriggered: result.escalation.triggered,
      fallbackReason: result.escalation.reason,
      claudeCalled,
      claudeRoute: result.claudeDecision?.route,
      claudeCorrect,
      claudeLatencyMs: result.claudeDecision?.latencyMs,
      claudeInputTokens: result.claudeDecision?.usage?.inputTokens,
      claudeOutputTokens: result.claudeDecision?.usage?.outputTokens,
      claudeEstimatedCostUsd: result.claudeDecision?.usage?.estimatedCostUsd,
      claudeProviderReportedCostUsd: result.claudeDecision?.usage?.providerReportedCostUsd,
      finalRoute,
      finalCorrect,
      finalProvider: result.finalDecision.provider === "claude" ? "claude" : "jev",
      totalLatencyMs: result.hybridMeta.totalLatencyMs,
      totalEstimatedCostUsd: result.hybridMeta.totalEstimatedCostUsd,
      jevResolvedWithoutFallback: !result.escalation.triggered,
      agreedWithClaude:
        claudeCalled && result.initialDecision ? result.initialDecision.route === result.claudeDecision?.route : undefined,
      claudeCorrectedJev: claudeCalled && initialJevCorrect === false && finalCorrect === true,
      claudeRegressedJev: claudeCalled && initialJevCorrect === true && finalCorrect === false,
      ...scored,
    };
  } catch (error) {
    if (error instanceof HybridFallbackFailedError) {
      // retryAfterMs is not recoverable here (Phase 8C-B): decideHybrid()'s
      // internal errorCategoryOf() already reduces the underlying Jev/
      // Claude error down to a class-name string before this error is
      // constructed, so the original error object (and any retryAfterMs on
      // it) no longer exists by the time it reaches this catch block. Left
      // unset rather than guessed — extending HybridFallbackFailedError or
      // decideHybrid() itself to preserve it is out of scope for this
      // phase (see phase8c-pacing-and-retry-metadata.md's deviations).
      return {
        ...base,
        strategy: "HYBRID",
        threshold,
        succeeded: false,
        errorCategory: "HybridFallbackFailedError",
        initialJevRoute: error.initialRoute as Route | undefined,
        initialJevConfidence: error.initialConfidence,
        initialErrorCategory: error.initialErrorCategory,
        fallbackTriggered: true,
        fallbackReason: error.fallbackReason,
        claudeCalled: true,
        jevResolvedWithoutFallback: false,
      };
    }

    return {
      ...base,
      strategy: "HYBRID",
      threshold,
      succeeded: false,
      errorCategory: errorCategoryOf(error),
      retryAfterMs: retryAfterMsOf(error),
      fallbackTriggered: false,
      claudeCalled: false,
      jevResolvedWithoutFallback: false,
    };
  }
}
