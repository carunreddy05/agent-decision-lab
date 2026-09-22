import { ROUTES, type Route } from "@/domain/route";

/**
 * A versioned, provider-neutral routing instruction set — shared by every
 * RouterProvider (mock heuristic excluded; it predates this spec and is
 * never counted in real benchmark numbers). Frozen once used for a real
 * benchmark run — a wording change after seeing results becomes
 * "routing-spec-v2", never an in-place edit to this file. See
 * benchmark/reports/phase4-jev-research.md §12-15 for the research this was
 * proposed from, and CLAUDE.md's dataset-integrity policy for why frozen
 * versions matter here too.
 *
 * Deliberately generic: no benchmark case IDs, no dataset prompts, no
 * dataset-specific phrasing — see the leakage-avoidance note in that report
 * (§29). Originally lived under `src/providers/jev/`; moved here in Phase 5
 * when `ClaudeRouterProvider` needed the identical spec — Claude must use
 * the same semantic routing specification already approved for Jev, not a
 * separate Claude-specific interpretation, so this now has exactly one
 * source of truth for both.
 */
export const ROUTING_SPEC_VERSION = "routing-spec-v1";

export const ROUTING_INSTRUCTIONS = `
Select exactly one route: the one that matches what the user is ultimately
asking for, not merely a system or identifier mentioned in passing. Route
based on the final artifact or operation the user is actually asking for.
For example, a request that mentions a ticket identifier but asks for the
code change that resolved it routes to the code-search route, not the
ticket route, because the code is what was asked for.

Route selection is a capability/routing decision about what this agent can
serve. It is separate from any downstream safety or policy decision about
whether a specific operation is permitted once identified — a route of
"outside supported capability" does not itself mean an operation was
denied for safety reasons; that is a later, independent decision.
`.trim();

/**
 * One line per route, worded to match the exact ground-truth definitions in
 * routing-v1.0.json / CLAUDE.md — not paraphrased, so the spec a provider
 * sees and the spec we scored ground truth against are the same document in
 * two places.
 */
export const ROUTE_CRITERIA: Record<Route, string> = {
  DIRECT_ANSWER: "A supported general software/engineering question answerable without an external system.",
  DOCS: "Retrieving supported documentation.",
  GITHUB: "Searching/reading supported code and pull-request information.",
  JIRA: "Searching/reading tickets or proposing supported Jira ticket creation.",
  REJECT:
    "Outside the developer-support agent's supported capability boundary or requesting an operation the lab does not model.",
};

/**
 * A plain-text rendering of `ROUTE_CRITERIA` for providers that take a text
 * system prompt rather than a native per-option criteria map (Jev's Choice
 * primitive takes `ROUTE_CRITERIA` directly as structured JSON; Claude's
 * tool-based approach needs it inlined into prose instead). Kept here,
 * generated from the same source data, so the two providers can never drift
 * into different route descriptions.
 */
export function renderRouteCriteriaList(): string {
  return ROUTES.map((route) => `- ${route}: ${ROUTE_CRITERIA[route]}`).join("\n");
}
