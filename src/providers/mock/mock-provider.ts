import type { Route, RoutingDecision, RoutingRequest } from "@/domain/route";
import { assertValidRoutingDecision } from "@/domain/validate";
import type { RouterProvider } from "../router-provider";

/**
 * Deterministic, network-free RouterProvider used for Phase 1-2 development
 * and in all automated tests. It is never used to produce reported benchmark
 * numbers (see ADR-005) — only real Jev/Claude calls count there.
 *
 * Scoring is a plain keyword heuristic, not a model. It exists to exercise
 * the rest of the pipeline (hybrid escalation, policy, tracing, UI) without
 * a paid API call, not to be a meaningful routing baseline.
 */
export class MockRouterProvider implements RouterProvider {
  readonly name = "mock";

  async decide(request: RoutingRequest): Promise<RoutingDecision> {
    const start = Date.now();
    const scores = scorePrompt(request.prompt);

    const total = Object.values(scores).reduce((sum, s) => sum + s, 0);
    const probabilities = Object.fromEntries(
      (Object.entries(scores) as [Route, number][]).map(([route, score]) => [
        route,
        round(score / total),
      ]),
    ) as Partial<Record<Route, number>>;

    const route = (Object.entries(probabilities) as [Route, number][]).reduce((best, current) =>
      current[1] > best[1] ? current : best,
    )[0];

    const decision: RoutingDecision = {
      route,
      provider: this.name,
      model: "mock-keyword-v1",
      confidence: probabilities[route],
      probabilities,
      latencyMs: Date.now() - start,
    };

    return assertValidRoutingDecision(decision);
  }
}

interface KeywordRule {
  route: Route;
  pattern: RegExp;
  weight: number;
}

const KEYWORD_RULES: KeywordRule[] = [
  { route: "JIRA", pattern: /\b[A-Z]{2,10}-\d+\b/, weight: 3 },
  { route: "JIRA", pattern: /\b(ticket|jira|issue)\b/i, weight: 1 },
  {
    route: "GITHUB",
    pattern: /\b(pull request|pr\s*#?\d+|github|commit|branch|repo(sitory)?)\b/i,
    weight: 2,
  },
  { route: "DOCS", pattern: /\b(docs?|documentation|guide|readme|how (do|to))\b/i, weight: 2 },
  {
    route: "REJECT",
    pattern: /\b(delete|drop table|wipe|destroy|shut ?down production)\b/i,
    weight: 3,
  },
];

const DIRECT_ANSWER_PRIOR = 0.5;

function scorePrompt(prompt: string): Record<Route, number> {
  const scores: Record<Route, number> = {
    DIRECT_ANSWER: DIRECT_ANSWER_PRIOR,
    DOCS: 0,
    GITHUB: 0,
    JIRA: 0,
    REJECT: 0,
  };

  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(prompt)) {
      scores[rule.route] += rule.weight;
    }
  }

  return scores;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
