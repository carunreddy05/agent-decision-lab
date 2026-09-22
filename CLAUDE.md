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
- **Confidence is not correctness.** Jev's returned value is documented as a
  provider-reported decision confidence / choice probability signal, used
  experimentally as an uncertainty signal — never described as "probability the
  answer is correct" unless Jev's own documentation explicitly supports that
  reading (it currently does not; see `benchmark/reports/phase4-jev-research.md`
  §10-11). Independent evaluation found real, direction-varying miscalibration
  out of distribution, so the hybrid threshold experiment is tracked as **YES,
  WITH LIMITATIONS** — the benchmark must measure whether higher reported
  confidence actually correlates with higher routing accuracy on our locked
  dataset, not assume it. Never manufacture a confidence number for Claude just
  to make the comparison look symmetric.
- **High-confidence wrong answers are the headline failure mode to track**, not just
  average accuracy — preserve the actual cases, don't fold them into an aggregate.
- **Everything destructive is simulated.** Never build a real destructive tool.
- **No employer/internal anything** — all examples, tickets, PRs, docs are fictional
  and synthetic (see `src/tools/fixtures/`).
- **Cost safety**: no paid API calls from tests, app startup, or build. The benchmark
  runner (Phase 7+) must be a standalone script outside the Next.js app process, and
  any real-provider run needs an explicit non-default flag plus your prior approval.
- **Minimal dependencies.** No Kubernetes/Kafka/Redis/DB/LangChain/agent frameworks.
  Currently: Next.js, React, TypeScript, Tailwind, vitest, tsx, plus each
  provider's own official first-party SDK where one exists (`@anthropic-ai/sdk`
  for Claude; Jev uses native `fetch` instead, since it's a thin JSON contract
  over Vercel's Gateway, not a case of avoiding official SDKs on principle).
  No zod — provider output is validated with hand-rolled type guards
  (`src/domain/validate.ts`).
- Work one phase at a time; checkpoint (tests + typecheck + lint, and build for UI
  phases) before moving on. Don't commit a phase's work until it's been reviewed,
  unless told otherwise.

## Phase status

- **Phase 0** (architecture proposal) — done.
- **Phase 1** (scaffold, domain model, policy engine, mock tools, tests) — done,
  committed (`feat: establish decision, policy, and mock tool boundaries`).
- **Phase 2** (interactive UI wired to the mock pipeline) — done, committed
  (`feat: add interactive decision and policy pipeline`).
- **Phase 3** (benchmark dataset + ground truth) — done, committed
  (`test: lock v1 routing benchmark dataset`). `routing-v1.0.json` is locked and
  immutable for the first Jev/Claude comparison — see
  `benchmark/reports/phase3-review.md` for labeling decisions and
  `tests/benchmark/dataset.test.ts` for the pinned-hash regression guard.
- **Phase 4** (Jev integration) — research approved
  (`benchmark/reports/phase4-jev-research.md`); `JevRouterProvider` implemented
  behind `RouterProvider` via Vercel AI Gateway's `/v1/evaluate` endpoint, model
  identifier `typesafe-ai/jev`, with mocked tests passing. **Corrected from the
  original research/implementation pass**, which had approved the
  TypeSafe-compatible passthrough (`/typesafe/v1/systemone`) with a pinned
  `jev-1.13.0` — a follow-up documentation check found Vercel's current
  guidance explicitly recommends `/v1/evaluate` for new integrations, and that
  `jev-1.13.0` is undocumented for any Gateway path (only `typesafe-ai/jev`
  is). See `benchmark/reports/phase4-jev-research.md`'s wire-format
  reconciliation addendum for the full analysis — this is a corrected
  implementation detail, not a reversed research conclusion.
  **Known reproducibility limitation, accepted deliberately**: the Gateway's
  raw HTTP response does not expose which concrete underlying Jev build
  answered a request behind the `typesafe-ai/jev` alias; this is recorded as
  `resolvedModelIdentifier: null` on every decision rather than guessed.
  **Phase 4 is done and closed**: three live smoke-test requests were made
  (not a benchmark — see `benchmark/reports/phase4-jev-research.md`'s "Live
  smoke-test record"), the third succeeded end-to-end with the real
  `/v1/evaluate` response matching every documented JSON path exactly. The
  second attempt's HTTP 403 exposed a real error-taxonomy gap, since fixed:
  `ProviderAuthorizationError` (403), `ProviderBillingError` (402), and
  `ProviderRequestError` (400/404/409/422 — a rejected *request*, kept
  distinct from `InvalidProviderOutputError`, which is now reserved for a
  *successful* response with a malformed body) were added, and
  `ProviderTimeoutError` gained a `client`/`upstream` origin. The 100-case
  benchmark itself has **not** run yet — that's a separate approval gate.
- **Phase 5** (Claude baseline integration) — research approved
  (`benchmark/reports/phase5-claude-research.md`); `ClaudeRouterProvider`
  implemented behind `RouterProvider` via the Messages API, model
  `claude-sonnet-5`, forced tool use (`select_route`, `strict: true`), with
  mocked tests passing. Deliberately reports **no confidence/probabilities**
  — nothing asks Claude to self-report certainty, and `RoutingDecision`
  already supports both fields being `undefined`. Thinking explicitly
  disabled; no temperature/top_p/top_k; `maxRetries: 0`. Reuses the Phase 4
  error taxonomy unchanged (no Claude-specific error types).
  `routing-spec.ts` moved from `src/providers/jev/` to `src/providers/` —
  Claude and Jev now share the exact same spec source, not two copies.
  **No real Claude API call has been made yet** — that requires a separate
  approval for the first live smoke test, same gate as Jev's Phase 4.
- **Phase 6+** (hybrid escalation, benchmark runner, real benchmark run,
  dashboard, reports, ADRs) — not started. Do not implement Hybrid, run the
  100-case benchmark, or make a real Claude API call until explicitly
  instructed — each has its own approval gate.

## Key files

- `src/domain/` — `Route`, `Action`, `PolicyDecision`, `Trace`, error types, validation.
  Error taxonomy: `ProviderTimeoutError` (now with a `client`/`upstream`
  `origin`) / `ProviderUnavailableError` / `InvalidProviderOutputError`
  (Phase 1, the last now reserved strictly for a *successful* response with
  a malformed body) plus, added across Phase 4 as real HTTP statuses
  exposed gaps: `ProviderAuthenticationError` (401),
  `ProviderAuthorizationError` (403 — distinct from 401: valid credentials,
  not permitted), `ProviderBillingError` (402), `ProviderRequestError`
  (400/404/409/422 — the provider rejected *our request*, never reaching
  model evaluation; kept separate from `InvalidProviderOutputError` on
  purpose), `ProviderRateLimitError` (429). See `errors.ts` doc comments for
  why each is distinct and what a caller should do differently for each.
  `RoutingDecision` carries `routingSpecVersion` and
  `UsageMetadata.providerReportedCostUsd` (kept separate from our own
  `estimatedCostUsd`) — both added Phase 4, both generic (not Jev-specific).
- `src/providers/` — `RouterProvider` interface; `routing-spec.ts`
  (`routing-spec-v1`, frozen once used for a real run — shared by every
  real provider, moved here from `jev/` in Phase 5 so Jev and Claude use
  exactly one spec, not two copies); `mock/mock-provider.ts` (deterministic
  keyword heuristic, never counted in real benchmark numbers); `jev/` (Jev
  via Vercel AI Gateway — `config.ts`, `jev-types.ts` (wire types, never
  imported outside this folder), `jev-client.ts` (fetch + timeout + HTTP
  error mapping, no retries), `jev-router-provider.ts`); `claude/` (Claude
  via the Messages API — `config.ts`, `claude-router-provider.ts`: uses the
  official `@anthropic-ai/sdk` directly rather than raw types, since
  Anthropic's typed exceptions and `Anthropic.Message`/`Anthropic.Tool`
  types are used as-is per the SDK's own convention).
- `src/policy/` — `policy-rules.ts` (the ALLOW/REQUIRE_REVIEW/DENY table),
  `policy-engine.ts`.
- `src/pipeline/` — `derive-action.ts`, `execute-action.ts`, `run-decision.ts` (the
  orchestrator: the only place decision → policy → execution are wired together).
- `src/tools/` — deterministic mock `docs`/`github`/`jira` tools over fixtures in
  `src/tools/fixtures/`.
- `benchmark/` — `datasets/routing-v1.0.json` (locked ground truth),
  `reports/` (`phase3-review.md`, `phase4-jev-research.md`,
  `phase5-claude-research.md`).
- `app/api/decide/route.ts` — the server boundary; the only caller of `runDecision`.
  Accepts a `provider` name (`"mock"` | `"jev"`) and resolves it to a
  `RouterProvider` server-side — the client only ever sends a name, never a key.
- `app/page.tsx`, `app/components/` — the Decision Lab UI (client-side).

## Commands

`npm run dev` / `npm run build` / `npm test` (vitest) / `npm run typecheck` /
`npm run lint` / `npm run benchmark:baseline` (Phase 2/3 heuristic baselines only —
never a Jev/Claude benchmark; see `scripts/phase3-baseline.ts`).

## Repo

GitHub remote `origin` is set to `https://github.com/carunreddy05/AgentDecisionLab`.
Nothing has been pushed yet — push only when explicitly asked.
