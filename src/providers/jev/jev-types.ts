/**
 * Raw wire types for Vercel AI Gateway's `/v1/evaluate` modality
 * (vercel.com/docs/ai-gateway/modalities/evaluation) — Vercel's own
 * cross-provider normalization of TypeSafe's System One API, not TypeSafe's
 * native shape. These are Jev's own shapes, not our domain model — nothing
 * here should be imported outside `src/providers/jev/`.
 * `jev-router-provider.ts` is the only place that translates them into a
 * `RoutingDecision`.
 *
 * Only the fields we actually consume are modeled — not the entire
 * response surface (e.g. `providerOptions`, other question types this
 * adapter never sends).
 */

export interface JevChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface JevEvaluateRequest {
  model: string;
  state: string;
  questions: Record<string, JevChoiceQuestion>;
}

/**
 * `/v1/evaluate` deliberately omits `confidence` here — it's relocated to
 * `providerMetadata.typesafe.confidence[questionId]` (see
 * `JevTypesafeMetadata`). Confirmed by two independent documented examples
 * on Vercel's evaluation-modality page, neither of which shows a
 * `confidence` field on a Choice answer.
 */
export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
}

export interface JevUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface JevGatewayRouting {
  originalModelId?: string;
  resolvedProvider?: string;
  canonicalSlug?: string;
  finalProvider?: string;
}

export interface JevGatewayMetadata {
  routing?: JevGatewayRouting;
  cost?: string;
  generationId?: string;
}

/**
 * TypeSafe-specific extension namespace within Vercel's generic
 * `providerMetadata` bag. `confidence` is a map from question id to the
 * derived confidence scalar for Choice/Score answers only (never present
 * for Boolean answers, which don't have a separate confidence concept) —
 * we only ever read the `route` key since that's our only question.
 */
export interface JevTypesafeMetadata {
  confidence?: Record<string, number>;
}

export interface JevProviderMetadata {
  gateway?: JevGatewayMetadata;
  typesafe?: JevTypesafeMetadata;
}

export interface JevEvaluateResponse {
  model: string;
  answers: Record<string, unknown>;
  usage: JevUsage;
  providerMetadata?: JevProviderMetadata;
}

export interface JevErrorBody {
  message: string;
  error_type: string;
}

export function isJevChoiceAnswer(value: unknown): value is JevChoiceAnswer {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === "choice" &&
    typeof candidate.choice === "string" &&
    typeof candidate.probabilities === "object" &&
    candidate.probabilities !== null
  );
}

export function isJevEvaluateResponse(value: unknown): value is JevEvaluateResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.model === "string" &&
    typeof candidate.answers === "object" &&
    candidate.answers !== null &&
    typeof candidate.usage === "object" &&
    candidate.usage !== null &&
    typeof (candidate.usage as Record<string, unknown>).inputTokens === "number" &&
    typeof (candidate.usage as Record<string, unknown>).outputTokens === "number"
  );
}
