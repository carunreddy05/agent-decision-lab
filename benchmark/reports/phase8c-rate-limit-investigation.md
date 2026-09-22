# Phase 8C-A — Jev Rate-Limit Investigation (INVESTIGATION ONLY)

No Jev request made. No Claude request made. No benchmark rerun. No
benchmark behavior modified. `20260922-165700-jev-only` was only read, never
modified/overwritten/merged/repaired/deleted.

---

## 1. Provider documentation findings

Two distinct, separately-documented rate-limit regimes are relevant to
this integration, and they are **not the same one**:

**A. TypeSafe's own direct API** (docs.typesafe.ai, already recorded in
Phase 4 research, `phase4-jev-research.md` §21): **250,000 tokens/second**
and **1,200 requests/minute**, explicitly described as adjusting
dynamically and subject to change. This is the limit for TypeSafe's
*native* API — a different access path than the one this project uses.

**B. Vercel AI Gateway's own limit** (fetched live today,
`vercel.com/docs/ai-gateway/rate-limits`, page `last_updated: 2026-09-08) —
**this is the actual access path our `JevRouterProvider` uses**
(`/v1/evaluate` via `ai-gateway.vercel.sh`). Key findings, quoted from the
current page:

- *"AI Gateway does not rate limit paid-tier requests. The free tier
  applies lower per-model limits, and a `429` on either tier may come from
  the upstream provider rather than from AI Gateway."*
- *"On the free tier, AI Gateway enforces a lower limit per model, and
  exceeding it rejects further requests to that model until your request
  rate drops."*
- **No fixed numeric limit is published for the free tier.** Verbatim:
  *"Limits can change, so this page describes behavior rather than fixed
  numbers. To confirm the current limit for a model, contact Vercel from
  your dashboard's Support entry."*
- Paid tier: Vercel's own Gateway-level limit is removed entirely; only
  the *upstream provider's* limit (i.e., regime A above, if TypeSafe's own
  limit applies to Gateway-routed traffic) would still constrain the
  request rate.
- A `429` response body from the Gateway itself: `{"error": {"message":
  "Rate limit exceeded", "type": "rate_limit_exceeded"}}`.
- `retry-after` header: *"Some `429` responses include a `retry-after`
  header with the number of seconds to wait. Honor it when it is
  present."* — documented as present only **sometimes**, not guaranteed on
  every 429.
- Rate limits are explicitly distinguished from **budgets** (spend caps):
  a budget rejection is `402` with `quota_for_entity_exceeded`, never
  `429`. Our observed failures were all `429`, confirming this was rate
  limiting, not a spend/budget cap.
- Vercel's own recommended retry approach: honor `retry-after` if present
  and parseable, otherwise exponential backoff, bounded attempts (their
  example uses `maxAttempts = 4`) — explicitly framed around *retrying the
  same request*, not pacing a batch of *different* requests, but the
  underlying signal (respect `retry-after`, back off) is the same
  principle this investigation needs for pacing between different cases.

**Conclusion on documentation:** the TypeSafe direct-API number (1,200
req/min ≈ 20 req/sec) almost certainly does **not** describe what we hit —
see the timing analysis in §3, where our observed natural cadence was only
~3.5 req/sec, far below that ceiling. What we most likely hit is the
**Vercel AI Gateway's own free-tier, per-model limit**, which Vercel
deliberately does not publish as a fixed number. This is stated as the
most likely explanation, not a certainty — see §5's unresolved questions
for what would be needed to confirm it precisely.

---

## 2. Existing failure metadata in the current adapter

The current `jev-client.ts` **already parses** the `Retry-After` header on
every `429` (line ~149):

```ts
case 429: {
  const retryAfterHeader = httpResponse.headers.get("Retry-After");
  const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
  return new ProviderRateLimitError(PROVIDER_NAME, Number.isFinite(retryAfterMs) ? retryAfterMs : undefined, body);
}
```

So `ProviderRateLimitError.retryAfterMs` **is a real, already-existing,
already-safe field** on the thrown error object (no credentials, no raw
body beyond the safe `body` param already used elsewhere) — nothing new
needs to be added to read it.

**However, it is not currently surfaced anywhere we can see after the
fact:**

- `logProviderFailure()` (the `[jev-provider-failure]` console diagnostic)
  logs `category`, `status`, `errorType`, `message`, `latencyMs` — **it
  does not log `retryAfterMs`**, even though the value is computed one
  function away.
- `case-runner.ts`'s `runJevOnlyCase` failure branch stores only
  `errorCategory: errorCategoryOf(error)` (a class-name string) — it does
  **not** currently capture `error.retryAfterMs` into the persisted
  `JevOnlyCaseResult` row.

**Consequence:** for the Phase 8B run specifically, we cannot know in
hindsight whether the Gateway sent a `Retry-After` header on our 70
failures, or what value it held, because that value was computed
in-process and then discarded — never logged, never persisted. This is a
real, honestly-reported gap, not something to guess around.

No logging or persistence change has been made in this investigation
phase.

---

## 3. Original timing analysis (from Phase 8B's own artifact, read-only)

**OBSERVED** (directly computed from `cases.jsonl`'s per-row `timestamp`
field, in exact dataset/request order — RC-001 through RC-100):

- Run wall-clock span: `2026-09-22T16:57:00.108Z` → `2026-09-22T16:57:14.878Z`
  = **14.77 seconds** for all 100 attempts.
- The first 30 requests (RC-001–RC-030) **all succeeded**, spanning
  `16:57:00.108Z` → `16:57:08.384Z` = **8.575 seconds**.
- Gaps between consecutive successful requests: min **199 ms**, mean
  **285.4 ms**, max **726 ms** — consistent with §B.12's reported
  successful-call latency (mean 283.7 ms). This is the *unpaced, natural*
  cadence of the existing sequential runner (each request starts
  immediately after the previous one's response arrives — no deliberate
  delay exists anywhere in the current code).
- The 31st request (RC-031), at `16:57:08.683Z` (8.575 s elapsed), is the
  **first failure**, and every one of the remaining 69 requests
  (RC-032–RC-100) also failed.
- **Zero successes occurred after the first failure** — verified
  programmatically, not just visually: no row after index 30 has
  `succeeded: true`.
- **Zero interleaving** — no failure occurs before the last success
  (index 29); the transition is a single, clean cut.
- Failed-request gaps shrank sharply after the cutover: typically
  **50–150 ms** between consecutive 429s, versus 200–400+ ms for
  successes — consistent with a 429 being rejected quickly by the Gateway
  (or upstream) without reaching full model evaluation.
- Average request rate over the successful window: 30 requests / 8.575 s
  ≈ **3.5 requests/second**.

**INFERRED** (lower confidence, explicitly flagged as inference):

- This ~3.5 req/sec natural cadence is far below TypeSafe's documented
  1,200 req/min (≈20 req/sec) ceiling, so the limit that tripped is very
  unlikely to be that one — most likely the Vercel AI Gateway's own
  (undocumented-by-number) free-tier per-model limit described in §1.
- The pattern (clean burst-then-wall, no recovery within the remaining
  ~6.2 seconds of the run) is *consistent with* either (a) a fixed
  short-window/request-count cap, or (b) a token-bucket burst allowance
  that was exhausted and did not refill within our run's remaining
  duration. **We cannot distinguish between these two from this evidence
  alone**, and no attempt is made to do so here.
- **"30 successes" is not necessarily "the limit is exactly 30 requests."**
  It is the number our *specific, unpaced* cadence happened to reach
  before tripping whatever the underlying threshold actually is. A
  different request cadence could plausibly trip the same underlying
  limit after a different number of successes. This is exactly the
  "do not infer an exact limit from the observed pattern" caution your
  instruction raised, and it is respected here.

---

## 4. Proposed pacing strategy

Because official documentation does **not** establish an exact applicable
number for our access path (§1), this is proposed as **a conservative
pacing experiment, not a guaranteed fix**:

- **Proposed fixed interval: 2,000 ms between the start of consecutive Jev
  requests** (≈30 requests/minute) — roughly **8.5x slower** than the
  ~3.5 req/sec natural cadence that tripped the limit in Phase 8B, and
  well under any per-model free-tier ceiling a reasonable gateway product
  would plausibly set. This is a deliberately conservative first attempt,
  not a number derived from any documented ceiling (none exists for this
  path, per §1).
- **Fully fixed, not adaptive**: the delay is the same before every
  request regardless of whether the previous call succeeded, failed, or
  what its content was. No logic reacts to answer correctness, confidence,
  or route — satisfying "do not use adaptive behavior based on answer
  correctness."
- **No per-case manual retries** — if a case still fails at this pace, it
  is preserved as a normal experimental failure row, exactly like Phase
  8B's failures, not retried individually.
- The rerun would **restart from case 1** and execute all 100 frozen
  cases, unconditionally — not a "fill in the missing 70" patch.

**Exact proposed code/config change** (not implemented — proposal only):
add an opt-in `--pacing-ms <N>` CLI flag to `scripts/benchmark-runner.ts`,
defaulting to `0` (today's exact unchanged behavior when omitted — every
existing test, dry-run, and prior artifact stays valid). When set, the
runner's per-case loop would `await sleep(N)` **after** processing each
case and **before** starting the next one, placed entirely inside
`benchmark-runner.ts`'s orchestration loop — never inside `case-runner.ts`,
`jev-client.ts`, or any provider adapter, and never touching how a single
case's `latencyMs` is measured (that measurement is already scoped tightly
around the one `fetch` call inside `jev-client.ts`, untouched by anything
in the outer loop). This keeps pacing a purely benchmark-execution
concern, never a provider-behavior or model-latency concern (see §6).

A secondary, smaller proposal (also not implemented): extend
`runJevOnlyCase`'s failure branch and `logProviderFailure` to also capture
`retryAfterMs` when the thrown error is a `ProviderRateLimitError`, so a
future rate-limit event is fully diagnosable from the artifact alone,
without needing this kind of manual timestamp reconstruction. This closes
the §2 gap for future runs; it does not change any existing behavior for
successful cases or non-rate-limit failures.

**Estimated wall-clock duration for the proposed rerun:** 100 cases ×
(≈250–300 ms natural response latency + 2,000 ms pacing delay) ≈
**225–230 seconds (≈3.8 minutes)** for a fully successful run. If some
requests still fail, failed requests return faster (§3: ~50–150 ms), so a
partially-failing run would complete somewhat faster than this upper
estimate, not slower.

---

## 5. Fairness implications relative to the completed Claude baseline

Two measurements are kept explicit and separate, per your instruction:

- **Model response latency** (`latencyMs` on each `JevOnlyCaseResult`
  row): unaffected by pacing. This field is populated entirely inside
  `jev-client.ts`'s `callJevEvaluate`, timed strictly around the one
  `fetch` call — the proposed `sleep(N)` lives in the outer runner loop in
  `scripts/benchmark-runner.ts` and would never be included in this
  measurement. A repaced Jev run's per-case `latencyMs` values would
  remain directly comparable to Claude's (and to Jev's own Phase 8B
  successful-case latencies) on an apples-to-apples basis.
- **Benchmark wall-clock throughput** (total run duration): would
  increase substantially for a paced Jev run (≈3.8 minutes vs. Phase 8B's
  14.8 seconds) — but this is proposed to be recorded and discussed as
  **benchmark execution configuration** (e.g., a `pacingMs` field on the
  run manifest, if this were implemented), never blended into or
  presented as part of Jev's model responsiveness.
- **No pacing is proposed for Claude.** Claude's Phase 8B run had zero
  failures of any kind — there is no methodological finding that would
  justify slowing it down, and doing so would only inflate its wall-clock
  time for no measurement benefit. Per your explicit instruction, Claude
  is not proposed to be rerun "merely to add artificial waiting."

---

## 6. Hybrid / threshold-simulation implication

If a new, fully-successful (or at least much-more-complete) 100-case Jev
run is produced under a new run ID, it would use:

- the same `routing-v1.0.json` (unchanged, hash-verified)
- the same `routing-spec-v1` (unchanged)
- the same exact 100 frozen prompts (unchanged — pacing affects only
  *when* a request is sent, never *what* is sent)
- the same, already-existing, already-frozen Claude baseline
  (`20260922-165824-claude-only`) — **no Claude rerun needed**
- the same scoring methodology (`src/benchmark/metrics/*`,
  `threshold-simulation.ts`) — unchanged

`simulateThreshold()` takes a `JevOnlyCaseResult[]` and a
`ClaudeOnlyCaseResult[]` as plain arguments — it has no dependency on
*which* Jev run produced the first array, so a new threshold-analysis
artifact could reference `sourceJevRunId: <new-paced-run-id>` alongside
the **existing, untouched** `sourceClaudeRunId:
20260922-165824-claude-only`, exactly as the design already supports. With
up to 100 (instead of 30) reconstructable cases, this would be the first
threshold analysis actually exercising the full dataset's confidence
distribution — meaningfully different from Phase 8B's degenerate
30-reconstructable-case result. **This analysis has not been run.**

---

## 7. Additional live calls / cost if approved

- Additional expected API calls: **up to 100 new live Jev requests** (0
  additional Claude requests — the existing Claude baseline is reused
  unchanged).
- Additional estimated cost: using the *actual observed* per-case token
  rate from Phase 8B's 30 successful calls (573.4 input / 62.8 output
  tokens/case on average — notably close to the original Phase 8A
  smoke-test-based estimate of ~578 in/63 out) and `pricing-v1-2026-09-22`
  ($0.042/1M input, $0 output): if all 100 cases succeed, ≈**$0.0024**
  total for the new Jev run — consistent with, not larger than, the
  original Phase 8A rough estimate. This is a projection from a 30-case
  sample, not a guarantee.

---

## 8. Unresolved questions

1. **Which limit did we actually hit — Gateway free-tier or an
   upstream/TypeSafe-side constraint specific to Gateway-routed traffic?**
   Vercel's own docs state a 429 "may come from the upstream provider
   rather than from AI Gateway" on either tier. We cannot distinguish
   these two from client-side evidence alone. Confirming this precisely
   would require contacting Vercel Support (as their docs themselves
   suggest) or TypeSafe directly — outside the scope of a code
   investigation.
2. **Is this Vercel team currently on the AI Gateway free tier or paid
   tier?** This is account/billing configuration, not something visible
   from the codebase or from a 429 response body alone, and directly
   determines whether Gateway-level throttling is even a possible
   explanation (paid tier removes it entirely, per §1).
3. **Was a `Retry-After` header actually present on Phase 8B's 70
   failures, and if so what value?** Unknown and unrecoverable after the
   fact — never logged or persisted (§2). Only a future run with the
   logging/persistence enhancement proposed in §4 would capture this.
4. **Is 2,000 ms actually sufficient?** No documentation confirms this — it
   is a conservative starting proposal, not a validated safe value. It is
   possible a rerun at this pace still hits the same wall (in which case
   that would itself be new, reportable evidence, not a reason to
   auto-retry more aggressively without your review).

---

## Explicit approval needed before any further action

1. Approval to add the opt-in `--pacing-ms` flag to
   `scripts/benchmark-runner.ts` (default `0`, no behavior change unless
   passed) — a benchmark-execution-configuration change only, touching no
   provider, dataset, spec, or scoring code.
2. Approval of the specific proposed pacing value (2,000 ms) for the first
   paced attempt, or an alternative value if you'd prefer a different
   starting point.
3. Approval to run a **new**, distinctly-run-ID'd, full 100-case
   `JEV_ONLY` benchmark at that pacing, up to 100 additional live Jev
   calls, at the projected ≈$0.0024 cost — with the explicit understanding
   that the original `20260922-165700-jev-only` run is preserved
   permanently and unmodified, and the two are never merged into a
   synthetic combined baseline.
4. (Optional, separable) Approval of the secondary proposal to also
   capture `retryAfterMs` in the console diagnostic and the persisted
   `JevOnlyCaseResult` failure row for future diagnosability — this can be
   approved independently of #1–3.
5. Confirmation of whether, after a successful new Jev run, you want the
   offline threshold simulation re-run against `{new Jev run ID, existing
   Claude run ID}` (§6) — no analysis code change would be needed, only a
   new invocation.

**STOP — investigation only. No code changed, no provider call made, no
benchmark rerun, no threshold simulation run.**

---

# PHASE 8C-B — Implementation (pacing + rate-limit metadata)

Approved and implemented. No Jev/Claude/Hybrid live request made. No
benchmark rerun. No threshold simulation run. The original
`20260922-165700-jev-only` run was not modified, overwritten, merged, or
deleted — verified unchanged (file list and modification timestamps
identical to Phase 8B) after this implementation.

## Why pacing was introduced

Phase 8B's Jev baseline hit 70/100 `ProviderRateLimitError` (HTTP 429)
failures; Phase 8C-A's investigation found the applicable limit (almost
certainly the Vercel AI Gateway's own free-tier per-model cap, not
TypeSafe's documented direct-API limit — see above) is not published as a
fixed number. A fixed, conservative pacing experiment was proposed as the
only reasonable next step, and is now implemented as an opt-in capability.
**No conclusion about Jev's quality, reliability, or suitability is drawn
here or anywhere in this document** — this section documents a benchmark
execution mechanism only.

## What was built

- **`--pacing-ms <integer>`** CLI flag (`src/benchmark/cli.ts`): optional,
  defaults to `0`, must be a non-negative integer (strict `^\d+$` match —
  rejects negative, decimal, non-numeric, and missing values before any
  provider execution). `0` is byte-for-byte the prior behavior.
- **Pacing lives only in the outer orchestration loop**
  (`scripts/benchmark-runner.ts`'s new `runPaced()` helper), never inside
  `case-runner.ts`, `hybrid-routing-strategy.ts`, or either provider
  adapter. It is **benchmark execution configuration**, not a provider or
  model property.
- **Fixed, non-adaptive**: `runPaced()` waits exactly `pacingMs` before
  every case except the first, unconditionally — never based on the prior
  case's latency, HTTP status, confidence, correctness, or success/failure.
  A 429 changes nothing about the next wait. No retry of the failed case is
  introduced anywhere.
- **Provider `latencyMs` is structurally unaffected**: `case-runner.ts`
  only ever copies `decision.latencyMs` from whatever the provider
  returned — pacing happens entirely before that call is even made, so a
  case's recorded latency reflects only its own provider round-trip, never
  the pacing wait that preceded it. Proven by a dedicated test (see below),
  not just asserted.
- **`pacingMs` is recorded in every run's `manifest.json`** (`RunManifest.pacingMs`,
  `src/benchmark/manifest.ts`) — always present, `0` when not requested,
  exact configured value otherwise. Also included in dry-run/preflight
  output (`DryRunPlan.pacingMs`, `src/benchmark/cli.ts`). Added additively
  to `benchmark-schema-v1`; **no schema version bump** — nothing in this
  codebase parses or validates a historical artifact against this schema's
  exact shape, so an old manifest (like Phase 8B's) simply predates the
  field rather than being invalidated by its absence. This is a judgment
  call, documented here per your instruction to document the smallest
  appropriate version change "if required" — it was judged not required.
- **`Retry-After` is observed, never obeyed automatically.** `jev-client.ts`
  already parsed it into `ProviderRateLimitError.retryAfterMs` before this
  phase; that value is now additionally propagated into the persisted
  benchmark result (`CaseResultBase.retryAfterMs?: number`,
  `src/benchmark/result-types.ts`) by `case-runner.ts`'s failure branches —
  only when the thrown error is actually a `ProviderRateLimitError` and
  actually carries a value; absent (never fabricated as `0`) otherwise. No
  retry/backoff behavior was added anywhere — this is observability only,
  exactly as scoped.
- **Existing error taxonomy is unchanged.** A `429` is still, and only,
  `ProviderRateLimitError`; no new error classification was created. The
  new metadata enriches the existing failure record.

## Known, documented limitation (not fixed, out of scope)

`retryAfterMs` **cannot** currently be recovered when a Hybrid case fails
via `HybridFallbackFailedError` — `decideHybrid()`'s internal
`errorCategoryOf()` already reduces the underlying Claude (or Jev) error to
a class-name string before constructing that error, discarding the
original error object (and any `retryAfterMs` on it) before
`case-runner.ts` ever sees it. Closing this would require touching
`src/domain/errors.ts` and/or `src/strategy/hybrid-routing-strategy.ts`,
which is out of this phase's scope (Jev/Claude adapters, case-runner,
manifest, CLI only) and was not done. This is documented and tested (a
dedicated test asserts `retryAfterMs` is `undefined` on this specific
path), not silently left broken.

## Fairness / latency methodology

- Jev's per-case `latencyMs` remains directly comparable to Claude's and to
  Jev's own Phase 8B successful-case figures — pacing cannot leak into it
  (see above).
- Benchmark wall-clock duration for a paced run will be longer, and that
  is recorded as `pacingMs` in the manifest — a property of *how the
  benchmark was executed*, never blended into or presented as Jev's model
  responsiveness.
- No pacing was added to Claude — the flag is generically available to any
  strategy, but nothing in this implementation applies it automatically,
  and no Claude-specific change was made or is proposed (Claude's Phase 8B
  run had zero failures).

## Status

No live validation of this pacing implementation has occurred yet — the
proposed 10-case validation call (see the closure report below) has not
been run. A future paced, full 100-case Jev baseline (if and when
approved) will receive its own new run ID, per §5 of the investigation
above; it will never be merged with `20260922-165700-jev-only`.
