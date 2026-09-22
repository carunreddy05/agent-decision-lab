import { ROUTES, type Route, type RoutingDecision, type RoutingRequest } from "@/domain/route";
import { InvalidProviderOutputError } from "@/domain/errors";
import { assertValidRoutingDecision } from "@/domain/validate";
import type { RouterProvider } from "../router-provider";
import {
  JEV_DEFAULT_TIMEOUT_MS,
  JEV_MODEL_ID,
  JEV_PRICING_SOURCE,
  JEV_RESOLVED_MODEL_VERSION_NOTE,
  JEV_STANDARD_PRICE_PER_MILLION_INPUT_TOKENS_USD,
} from "./config";
import { callJevEvaluate } from "./jev-client";
import { isJevChoiceAnswer } from "./jev-types";
import { ROUTE_CRITERIA, ROUTING_INSTRUCTIONS, ROUTING_SPEC_VERSION } from "./routing-spec";

const ROUTE_QUESTION_KEY = "route";

/**
 * Normalizes Jev's native Choice primitive, as exposed through Vercel AI
 * Gateway's `/v1/evaluate` modality, into a RoutingDecision. All Jev/Gateway
 * -specific types stay inside `src/providers/jev/` — this is the only file
 * that touches the domain layer.
 *
 * Confidence/probability handling follows the Phase 4 research finding
 * (benchmark/reports/phase4-jev-research.md §10-11, reconfirmed in the wire
 * -format reconciliation): these are stored as provider-reported values and
 * nothing more. Nothing here describes them as a probability of
 * correctness, and nothing assumes they are calibrated.
 */
export class JevRouterProvider implements RouterProvider {
  readonly name = "jev";

  constructor(private readonly timeoutMs: number = JEV_DEFAULT_TIMEOUT_MS) {}

  async decide(request: RoutingRequest): Promise<RoutingDecision> {
    const { response, latencyMs } = await callJevEvaluate(
      {
        model: JEV_MODEL_ID,
        state: request.prompt,
        questions: {
          [ROUTE_QUESTION_KEY]: {
            type: "choice",
            instructions: ROUTING_INSTRUCTIONS,
            criteria: ROUTE_CRITERIA,
          },
        },
      },
      { timeoutMs: this.timeoutMs },
    );

    const routeAnswer = response.answers[ROUTE_QUESTION_KEY];
    if (!isJevChoiceAnswer(routeAnswer)) {
      throw new InvalidProviderOutputError(
        `Jev response is missing a valid "${ROUTE_QUESTION_KEY}" choice answer.`,
        response,
      );
    }

    if (!isRoute(routeAnswer.choice)) {
      throw new InvalidProviderOutputError(`Jev returned an unrecognized route: "${routeAnswer.choice}".`, response);
    }

    const probabilities = normalizeProbabilities(routeAnswer.probabilities, response);
    const confidence = extractConfidence(response, response.providerMetadata?.typesafe?.confidence);

    const gateway = response.providerMetadata?.gateway;
    const providerReportedCostUsd = parseProviderCost(gateway?.cost);
    const estimatedCostUsd =
      (response.usage.inputTokens * JEV_STANDARD_PRICE_PER_MILLION_INPUT_TOKENS_USD) / 1_000_000;

    const candidate: RoutingDecision = {
      route: routeAnswer.choice,
      provider: this.name,
      model: response.model,
      confidence,
      probabilities,
      latencyMs,
      routingSpecVersion: ROUTING_SPEC_VERSION,
      usage: {
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        estimatedCostUsd,
        ...(providerReportedCostUsd !== undefined ? { providerReportedCostUsd } : {}),
      },
      rawMetadata: {
        estimatedCostPricingSource: JEV_PRICING_SOURCE,
        providerReportedCostNote:
          "Actual Vercel AI Gateway billed cost; may reflect promotional pricing in effect at call time",
        requestedModelIdentifier: JEV_MODEL_ID,
        // Recorded explicitly as null rather than omitted, per the Phase 4
        // reproducibility decision: the raw HTTP Gateway response does not
        // expose the concrete underlying Jev build behind this alias, and
        // we do not infer one.
        resolvedModelIdentifier: null,
        modelVersionResolution: JEV_RESOLVED_MODEL_VERSION_NOTE,
        ...(gateway?.routing?.resolvedProvider ? { resolvedProvider: gateway.routing.resolvedProvider } : {}),
        ...(gateway?.generationId ? { generationId: gateway.generationId } : {}),
      },
    };

    return assertValidRoutingDecision(candidate);
  }
}

function isRoute(value: string): value is Route {
  return (ROUTES as readonly string[]).includes(value);
}

/**
 * Preserves only the probability entries Jev actually returned for keys we
 * recognize as routes — never fabricates a value for a route Jev didn't
 * mention, and never silently drops an unrecognized key without surfacing
 * it as an error, since that would hide a spec/criteria mismatch.
 *
 * No hard sum-to-1 check: Vercel's documented Choice examples always sum to
 * 1, but that isn't stated as a guaranteed contract, and enforcing it here
 * would require picking a floating-point tolerance the docs don't specify.
 * Each individual value is still range-checked below.
 */
function normalizeProbabilities(
  raw: Record<string, number>,
  rawResponseForError: unknown,
): Partial<Record<Route, number>> {
  const result: Partial<Record<Route, number>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isRoute(key)) {
      throw new InvalidProviderOutputError(
        `Jev returned a probability for an unrecognized route key: "${key}".`,
        rawResponseForError,
      );
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new InvalidProviderOutputError(`Jev returned an invalid probability for "${key}": ${String(value)}.`, rawResponseForError);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Confidence lives at `providerMetadata.typesafe.confidence.route` for
 * `/v1/evaluate` (not inline on the answer, unlike TypeSafe's native
 * shape — see the wire-format reconciliation). Missing metadata is
 * tolerated (confidence is optional on RoutingDecision; evaluateEscalation
 * already handles its absence) — but if the field is present and
 * malformed, that's a genuine contract violation, not an absence.
 */
function extractConfidence(rawResponseForError: unknown, confidenceMap: Record<string, number> | undefined) {
  if (confidenceMap === undefined || !(ROUTE_QUESTION_KEY in confidenceMap)) {
    return undefined;
  }
  const value = confidenceMap[ROUTE_QUESTION_KEY];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new InvalidProviderOutputError(
      `Jev returned a malformed confidence value for "${ROUTE_QUESTION_KEY}": ${String(value)}.`,
      rawResponseForError,
    );
  }
  return value;
}

/** Ignores an absent or unparseable cost string rather than producing NaN. */
function parseProviderCost(cost: string | undefined): number | undefined {
  if (cost === undefined) return undefined;
  const parsed = Number(cost);
  return Number.isFinite(parsed) ? parsed : undefined;
}
