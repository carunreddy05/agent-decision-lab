@AGENTS.md

# Agent Decision Lab

Personal, public-facing engineering experiment. Not a product, not a Jev vs. Claude
marketing exercise, not an employer project — treat every negative or inconclusive
result as a valid outcome, not something to fix.

## Core question

Where should probabilistic AI decision-making end and deterministic software control
begin? Secondary question: does every bounded routing decision require a
general-purpose LLM, or can a specialized decision model handle routine cases and
escalate uncertainty?

## Mental model

Jev decides. Claude helps when Jev isn't sure. Software stays in control.

More precisely: **DECISION != AUTHORIZATION != EXECUTION**. A model recommending an
action never grants it authority to run — a deterministic policy engine, with no
visibility into confidence or model identity, is the only thing that can ALLOW /
REQUIRE_REVIEW / DENY it.

## Architecture boundaries (all four are hard interfaces, not conventions)

1. **Decision boundary** — `RouterProvider` (`src/providers/`) takes a prompt, returns
   a `RoutingDecision` (route + optional confidence/probabilities). Providers never see
   anything past this.
2. **Uncertainty/escalation boundary** — compares confidence against a configurable
   threshold (default 0.80, never claimed optimal) to decide whether a hybrid run
   would escalate to Claude. Distinguishes **uncertainty fallback** (valid decision,
   low confidence) from **technical failure fallback** (timeout/error/malformed
   output) — these are different architectural events, never merged into one boolean.
3. **Policy boundary** — `evaluatePolicy(action: Action)` in `src/policy/`. Signature
   takes *only* an Action — no confidence, no model name can reach it even by
   accident. This is the one non-negotiable line in the whole system.
4. **Execution boundary** — mock tools in `src/tools/` run only after ALLOW.
   Destructive actions (`DELETE_DATABASE`) are always DENY and have no real adapter —
   there is nothing to accidentally wire up later.

`Route` (where a request belongs: DIRECT_ANSWER/DOCS/GITHUB/JIRA/REJECT) and `Action`
(what operation is proposed: READ_DOCS/CREATE_JIRA/DELETE_DATABASE/etc.) are
deliberately separate domain types — a route alone can't safely imply an action.
`src/pipeline/derive-action.ts` maps them, and runs a destructive-intent check
*independently of and before* the route switch, so a dangerous request still reaches
policy (and gets denied) even if the router itself misroutes or rejects it.

## Guardrails that apply to every phase

- **Fairness**: Jev and Claude get the same dataset, ground truth, and semantically
  equivalent instructions. No dataset changes after seeing results except genuine,
  recorded label corrections.
- **Confidence is not correctness.** Never describe Jev's confidence as calibrated
  unless calibration is actually measured. Never manufacture a confidence number for
  Claude just to make the comparison look symmetric.
- **High-confidence wrong answers are the headline failure mode to track**, not just
  average accuracy — preserve the actual cases, don't fold them into an aggregate.
- **Everything destructive is simulated.** Never build a real destructive tool.
- **No employer/internal anything** — all examples, tickets, PRs, docs are fictional
  and synthetic (see `src/tools/fixtures/`).
- **Cost safety**: no paid API calls from tests, app startup, or build. The benchmark
  runner (Phase 7+) must be a standalone script outside the Next.js app process, and
  any real-provider run needs an explicit non-default flag plus your prior approval.
- **Minimal dependencies.** No Kubernetes/Kafka/Redis/DB/LangChain/agent frameworks.
  Currently: Next.js, React, TypeScript, Tailwind, vitest, tsx. No zod — provider
  output is validated with hand-rolled type guards (`src/domain/validate.ts`).
- Work one phase at a time; checkpoint (tests + typecheck + lint, and build for UI
  phases) before moving on. Don't commit a phase's work until it's been reviewed,
  unless told otherwise.

## Phase status

- **Phase 0** (architecture proposal) — done.
- **Phase 1** (scaffold, domain model, policy engine, mock tools, tests) — done,
  committed (`feat: establish decision, policy, and mock tool boundaries`).
- **Phase 2** (interactive UI wired to the mock pipeline) — built, verified (tests/
  typecheck/lint/build all pass, manually exercised via dev server), **not yet
  committed** — pending your review of the checkpoint.
- **Phase 3+** (benchmark dataset, Jev integration, Claude integration, hybrid
  escalation, benchmark runner, real benchmark run, dashboard, reports, ADRs) — not
  started. Do not integrate Jev or Claude, run paid APIs, or generate the benchmark
  dataset until explicitly instructed — each of those has its own approval gate.

## Key files

- `src/domain/` — `Route`, `Action`, `PolicyDecision`, `Trace`, error types, validation.
- `src/providers/` — `RouterProvider` interface; `mock/mock-provider.ts` (deterministic
  keyword heuristic, never counted in real benchmark numbers).
- `src/policy/` — `policy-rules.ts` (the ALLOW/REQUIRE_REVIEW/DENY table),
  `policy-engine.ts`.
- `src/pipeline/` — `derive-action.ts`, `execute-action.ts`, `run-decision.ts` (the
  orchestrator: the only place decision → policy → execution are wired together).
- `src/tools/` — deterministic mock `docs`/`github`/`jira` tools over fixtures in
  `src/tools/fixtures/`.
- `app/api/decide/route.ts` — the server boundary; the only caller of `runDecision`.
  Keeps future Jev/Claude API keys server-side.
- `app/page.tsx`, `app/components/` — the Decision Lab UI (client-side).

## Commands

`npm run dev` / `npm run build` / `npm test` (vitest) / `npm run typecheck` /
`npm run lint`.

## Repo

GitHub remote `origin` is set to `https://github.com/carunreddy05/AgentDecisionLab`.
Nothing has been pushed yet — push only when explicitly asked.
