# Phase 6A — Hybrid Routing Design Checkpoint (DESIGN ONLY, no implementation)

No code written. No provider call made. No benchmark run.
`routing-v1.0.json` and `routing-spec-v1` untouched;
`JevRouterProvider`/`ClaudeRouterProvider` behavior untouched.

A key finding up front, from re-reading the existing domain model before
proposing anything new: **the Phase 1 `Trace`/`EscalationInfo` types were
already designed with Hybrid in mind.** `Trace.decision` already has
`{ jev?, claudeFallback?, final }`, and `EscalationReason` already includes
`UNCERTAINTY_FALLBACK`/`TECHNICAL_FAILURE_FALLBACK` as literal values that
were simply unused placeholders until now. This shaped the whole proposal
below toward *filling in* that existing shape rather than redesigning it.

---

## 1–3. Proposed abstraction, file structure, control flow

**Abstraction:** a standalone `decideHybrid()` function (not a class/interface
hierarchy — "prefer... not framework-heavy" from your instruction) in a new
module, called by the pipeline orchestrator exactly the way
`JevRouterProvider.decide()`/`ClaudeRouterProvider.decide()` are called
today, but returning a richer result than a bare `RoutingDecision` (it has
to — it needs to report on *two* possible provider calls, not one).

**Proposed file:** `src/strategy/hybrid-routing-strategy.ts` — a new
top-level `src/strategy/` directory, sibling to `providers/`, `policy/`,
`pipeline/`. Reasoning: this module's whole job is "decide which provider(s)
to call and which decision wins," which is neither a provider concern
(providers stay dumb — call and normalize, nothing else) nor an
action/policy/execution concern (`pipeline/`). It's a distinct layer, and
your instruction's own wording ("RoutingStrategy", "HybridRoutingStrategy")
suggested the same thing. Open to `src/pipeline/hybrid-routing-strategy.ts`
instead if you'd rather not add a new top-level directory for one file —
flagged as a naming/location choice, not a load-bearing decision.

**Control flow:**

```
decideHybrid(request, options)
  ↓
call jevProvider.decide(request), timed independently by this function
  ↓
Jev threw?
  ├── YES → is the error in the "fail fast" set (§4)?
  │           ├── YES → rethrow immediately. No trace built. No Claude call.
  │           └── NO  → call claudeProvider.decide(request) [reason: TECHNICAL_FAILURE_FALLBACK]
  │                       ├── Claude also throws → throw a new HybridFallbackFailedError
  │                       │     wrapping both (see §5, §10 in numbered list below)
  │                       └── Claude succeeds → final = Claude, escalation.triggered = true
  └── NO (Jev succeeded) → Jev confidence undefined?
        ├── YES → proposed: same fallback-to-Claude shape as above, but a
        │          NEW distinct reason (§6/§7 below — needs your approval,
        │          not silently reusing UNCERTAINTY_FALLBACK)
        └── NO  → confidence >= threshold?
              ├── YES → final = Jev, escalation.triggered = false,
              │          reason = CONFIDENCE_ABOVE_THRESHOLD. Claude never called.
              └── NO  → call claudeProvider.decide(request) [reason: UNCERTAINTY_FALLBACK]
                          ├── Claude throws → HybridFallbackFailedError (same as above)
                          └── Claude succeeds → final = Claude, escalation.triggered = true
```

Claude is **never** given Jev's route or asked to critique it — same
`request` (the raw prompt) goes to both providers independently, exactly as
your instruction requires. No averaging, no voting.

`decideHybrid()` itself never touches `deriveAction`/`evaluatePolicy`/
execution — those stay exactly as they are today, called once by
`runDecision` on whichever decision `decideHybrid()` returns as final. This
is the "providers/strategy decide the route; the existing pipeline tail
decides the action" boundary your instruction asked for.

---

## 4. Proposed error-class split (fallback-eligible vs. fail-fast)

| Category | Classes | Behavior |
|---|---|---|
| **Transient/runtime** (Claude fallback allowed) | `ProviderTimeoutError`, `ProviderRateLimitError`, `ProviderUnavailableError` | These describe the *service*, not the *account/request*, being in a bad-but-possibly-temporary state. Retrying via a different provider is a defensible substitute for retrying Jev itself (which we deliberately don't do — no retries, per Phase 4/5). |
| **Configuration/account/request** (fail fast, no fallback) | `ProviderAuthenticationError`, `ProviderAuthorizationError`, `ProviderBillingError`, `ProviderRequestError` | These describe *our setup* being wrong — bad credentials, insufficient permission, a billing/workspace gate (exactly what we hit twice in real life: Jev's 403 in Phase 4, Claude's workspace-scoping 400 in Phase 5), or a malformed outbound request. Falling back here would make a broken experimental setup produce a plausible-looking Hybrid result, silently laundering a Jev misconfiguration into "the system just used Claude that time." |

**Open question, not decided:** `InvalidProviderOutputError` (Jev
responded, but the body didn't validate) appears in **neither** of your two
example lists. My recommendation: **fail fast**, grouped with the
configuration/account bucket — a malformed *successful* response points at
a wiring/contract problem (our parsing, or a Jev regression), not a
transient service hiccup, and papering over it with Claude risks hiding a
real integration bug the same way silently falling back on a 403 would have
hidden Phase 4's account issue. Flagging for your explicit sign-off, not
assuming it.

**Rationale, restated in one line:** *if retrying with a different tool
might reasonably produce a different, valid outcome, fall back; if the
problem is that our own credentials/request/setup are wrong, no provider
swap fixes that, and hiding it defeats the purpose of a fair benchmark.*

---

## 5. Behavior when Claude fails after being called for a fallback

Per your instruction: **the whole Hybrid request fails.** No trace is
built, no `RoutingDecision` is returned, and Jev's original (uncertain or
absent) decision is never resurrected as if it were trustworthy.

Proposed mechanism: a new, narrow domain error —

```ts
export class HybridFallbackFailedError extends Error {
  constructor(
    public readonly reason: "UNCERTAINTY_FALLBACK" | "TECHNICAL_FAILURE_FALLBACK",
    public readonly initialDecision: RoutingDecision | undefined,
    public readonly initialError: unknown,
    public readonly claudeError: unknown,
  ) { ... }
}
```

This is thrown (not returned) by `decideHybrid()`, propagates up through
`runDecision` exactly the way a plain provider error does today, and is
caught by `app/api/decide/route.ts`'s existing instanceof-chain (one more
branch added) to produce a 502 that can say *why* — e.g. "Jev was
uncertain (confidence 0.63 < 0.80), and the Claude fallback then failed:
ProviderRateLimitError." Both halves of the story are preserved on the
thrown object for logging, even though no `Trace` is produced. This mirrors
exactly how a plain Jev-only or Claude-only technical failure already
behaves (throw, don't fabricate a trace) — Hybrid doesn't get special,
softer treatment just because two providers were involved.

**Needs your approval:** this is a new addition to `src/domain/errors.ts`.

---

## 6–7. Threshold behavior, confidence semantics, missing confidence

- **`>= threshold` means no fallback** (not `>`), exactly as your
  instruction recommends. Implemented as a direct comparison, no fuzzing.
- **`confidence === threshold` exactly:** covered by the same `>=` — no
  special-cased branch needed, this isn't actually an open question, just
  confirming the boundary is handled by one comparison operator.
- **Only Jev's real `confidence` field is used.** No Claude confidence is
  computed, no combination, no treating `probabilities[route]` as a
  confidence substitute (Jev's `confidence` and
  `probabilities[selected route]` are already documented as related-but-
  distinct in the Phase 4 research — this design doesn't conflate them).
- **Missing Jev confidence (`decision.confidence === undefined` on a
  successful Jev response):** this is real and already tolerated by
  `JevRouterProvider` itself (a Phase 4 test explicitly covers "missing
  confidence metadata" as a valid, non-error state). Hybrid cannot evaluate
  `undefined >= threshold` meaningfully — relying on the JS-coercion
  accident where that comparison happens to be `false` would be exactly the
  "pretend confidence is zero" behavior your instruction forbids (it's not
  zero, it's *absent*, a different thing).

  **Proposed behavior (not implemented, needs your sign-off): fall back to
  Claude**, on the reasoning that proceeding with Jev's route with *zero*
  confidence information is strictly worse than getting a second opinion,
  and staying silent about *why* would be worse still. Recorded as a
  **new, distinct `EscalationReason`** — proposed name
  `MISSING_CONFIDENCE_FALLBACK` — rather than folding it into
  `UNCERTAINTY_FALLBACK`, because "Jev confidently reports low certainty"
  and "Jev reports no certainty signal at all" are different architectural
  events and your own project principle throughout this whole build has
  been not to merge distinct events into one label. **This is a new
  `EscalationReason` domain literal and needs your approval before I add
  it.**

---

## 8. Provider-neutral strategy layer

Addressed in §1–3: `decideHybrid()` only calls `.decide()` on whatever
`RouterProvider` instances it's given (defaulting to `new
JevRouterProvider()` / `new ClaudeRouterProvider()`, injectable for tests
the same way `runDecision` already injects a single provider today). It
never reaches into Jev- or Claude-specific internals. Neither
`JevRouterProvider` nor `ClaudeRouterProvider` gains any Hybrid-awareness —
they remain exactly what they are today, single-decision providers that
don't know they're sometimes called from within a larger strategy.

---

## 9. Trace / observability changes

**The existing `Trace` shape already covers most of what your instruction
lists**, once actually populated correctly:

| Your requested field | Where it already lives |
|---|---|
| `strategy = HYBRID` | `Trace.strategy` (existing field — see the bug noted below) |
| `initialProvider` | Implicitly always `"jev"` in this design (Jev is always first, by your explicit architecture) — not worth a dedicated field for something that never varies, but flagging in case you'd rather have it explicit for benchmark-script convenience |
| `initialRoute` / `initialConfidence` | `decision.jev.route` / `decision.jev.confidence` (existing optional field, populated whenever Jev produced a decision) |
| `threshold` | `escalation.threshold` (existing field) |
| `fallbackTriggered` | `escalation.triggered` (existing field — currently hardcoded `false` everywhere; Hybrid is the first real consumer that sets it `true`) |
| `fallbackReason` | `escalation.reason` (existing field — `UNCERTAINTY_FALLBACK`/`TECHNICAL_FAILURE_FALLBACK` already exist as literals, unused until now) |
| `fallbackProvider` / `finalProvider` | `decision.final.provider` (existing field — always tells you which provider's decision won) |
| `finalRoute` | `decision.final.route` (existing field) |
| Claude's decision when called | `decision.claudeFallback` (existing optional field) |

**What's genuinely missing**, and the only proposed additions:

1. **`initialErrorCategory`** — when Jev fails technically, there's no
   `RoutingDecision` to attach anything to, so `decision.jev` stays
   `undefined` and we lose *why* Jev failed unless we record it somewhere.
2. **Per-provider attempt latency, captured even on failure** — a thrown
   error carries no latency (confirmed by reading `jev-client.ts`: it logs
   latency internally but never attaches it to the thrown error object), so
   `decision.jev?.latencyMs` is unavailable exactly when we'd most want to
   know how long the failed attempt took.
3. **Total Hybrid orchestration latency** — for a fallback case,
   `decision.final.latencyMs` is *only* Claude's latency; the real wall-clock
   (Jev attempt + Claude attempt) is a different, larger number that would
   otherwise be lost, understating Hybrid's true cost in any later benchmark
   analysis.
4. **Aggregate cost** — per-provider cost is already fully available via
   `decision.jev?.usage`/`decision.claudeFallback?.usage` (each a complete
   `UsageMetadata`), but nothing currently sums them.

**Proposed: one new optional field on `Trace`, nothing else restructured:**

```ts
export interface HybridMeta {
  initialErrorCategory?: string;   // Jev's error class name, only on TECHNICAL_FAILURE_FALLBACK
  initialLatencyMs?: number;       // Jev's attempt latency, measured by decideHybrid() itself
                                    // (independent of whether Jev succeeded), always present in a Hybrid trace
  claudeLatencyMs?: number;        // Claude's attempt latency, only when Claude was called
  totalLatencyMs: number;          // full decideHybrid() wall-clock
  totalEstimatedCostUsd: number;   // sum of whichever provider(s) actually ran
}

// Trace gains: hybridMeta?: HybridMeta;
```

This directly answers your design-checkpoint items 11–16:
- **Provider-level latency:** `decision.jev?.latencyMs` /
  `decision.claudeFallback?.latencyMs` (existing, on-success) plus
  `hybridMeta.initialLatencyMs` / `.claudeLatencyMs` (new, always-present
  attempt timing, independent of success).
- **Total latency:** `hybridMeta.totalLatencyMs` (new).
- **Provider-level cost:** `decision.jev?.usage` /
  `decision.claudeFallback?.usage` — each already a full `UsageMetadata`
  with `estimatedCostUsd`/`providerReportedCostUsd` — nothing new needed.
- **Aggregate cost:** `hybridMeta.totalEstimatedCostUsd` (new).
- **Provider-level usage:** same as cost — already fully preserved,
  per-provider, via the existing `decision.jev?.usage` /
  `decision.claudeFallback?.usage` slots. Never merged into one blended
  usage object, per your instruction §11.

**Also fixing, because Hybrid can't report itself correctly otherwise:**
`runDecision` currently hardcodes `strategy: "MOCK"` regardless of which
provider actually ran — a pre-existing bug (Jev-only and Claude-only traces
have been mislabeled `"MOCK"` since Phase 4/5). This isn't scope creep so
much as a prerequisite: Hybrid literally cannot report `strategy: "HYBRID"`
without this line changing, and fixing it only for Hybrid while leaving
Jev/Claude mislabeled would be a strange half-fix. Proposing to compute
`strategy` correctly for all four cases (`MOCK`/`JEV_ONLY`/`CLAUDE_ONLY`/
`HYBRID`) as one small, clearly-scoped correction alongside the Hybrid work.

---

## 10. Cost accounting

Covered in §9: `hybridMeta.totalEstimatedCostUsd` sums whichever of
`decision.jev?.usage?.estimatedCostUsd` / `decision.claudeFallback?.usage?.estimatedCostUsd`
are present. Per your instruction: **never** fabricate a Claude
`providerReportedCostUsd` (it stays `undefined`, exactly as it already does
outside Hybrid), and **never** substitute Jev's real provider-reported cost
with our own estimate — both `estimatedCostUsd` and (when present)
`providerReportedCostUsd` stay on their own provider's `usage` object
untouched.

---

## 11. Usage accounting

Also covered in §9: `decision.jev?.usage` and `decision.claudeFallback?.usage`
remain two separate, fully-provenanced `UsageMetadata` objects. No merged
"hybrid usage" object is introduced. If a convenience aggregate ever proves
useful for the UI, it would be computed on the fly at render time from these
two, never stored as a third source of truth.

---

## 12. Policy boundary

Unchanged, structurally guaranteed the same way it already is: `decideHybrid()`
returns a `RoutingDecision`; `runDecision` calls the *existing*
`deriveAction(decision.route, prompt)` → `evaluatePolicy(action)` exactly
once, on whichever decision came out final. `evaluatePolicy`'s signature
still takes only an `Action` — it has no way to know a decision came from
Hybrid, Jev-only, or Claude-only, let alone whether a fallback occurred.
Planned test: assert that an identical final route/action produces an
identical policy result regardless of whether it arrived via Jev-direct or
via Claude-after-fallback — the same pattern already used in both the Jev
and Claude test suites for the "no policy bypass" property.

---

## 13. UI changes proposed

Minimal, matching your "not flashy" instruction:

- `"hybrid"` added as a fourth `PROVIDER_OPTIONS` entry alongside
  Mock/Jev/Claude.
- In `ResultView`, when `trace.strategy === "HYBRID"`, add one additional
  small panel (or extend the existing "Escalation" panel, which already
  exists and already shows `threshold`/`escalation.detail`) showing: Jev's
  initial route + confidence, whether fallback occurred, the fallback
  reason, Claude's final route (when called), and — when no fallback
  occurred — the plain text **"No fallback."**
- The existing **"AI decision ends here"** boundary marker stays exactly
  where it is, unmoved, still separating the (now possibly two-provider)
  decision phase from policy/execution.
- No new visual language, no fake confidence bar for the Claude-fallback
  case (Claude still reports none, shown the same "not available for this
  provider" way it already is today).

---

## 14. No benchmark yet

Confirmed understood — this phase is implementation + mocked tests only. A
single live Hybrid smoke test would follow later, under the same
approval-gated protocol as every other live call so far in this project,
not assumed here.

---

## 15. Tests planned (mapping to your A–R list)

All in a new `tests/strategy/hybrid-routing-strategy.test.ts`, using
lightweight stub `RouterProvider` implementations (not the real
Jev/Claude adapters) — zero real provider calls, consistent with every
prior test suite in this project:

- **A–C** (above/at/below threshold): three tests asserting `finalDecision`,
  whether Claude's stub was invoked (call-count assertion), and
  `escalation.reason`.
- **D–F** (Jev timeout/unavailable/rate-limit): three tests confirming
  fallback-eligible errors trigger a Claude call and `TECHNICAL_FAILURE_FALLBACK`.
- **G–J** (Jev auth/authorization/billing/request failures): four tests
  confirming these rethrow immediately, no Claude call, matching §4's
  proposed split (pending your approval of that split, including the
  `InvalidProviderOutputError` open question).
- **K** (missing Jev confidence): one test for whatever behavior you
  approve in §7.
- **L, M** (Claude fails after either fallback type): two tests asserting
  `HybridFallbackFailedError` is thrown, carrying both the initial and
  Claude failure context, and that no `Trace`/`RoutingDecision` is returned.
- **N** (policy still controls the final action): one test in
  `tests/pipeline/run-decision.test.ts` (not the strategy test file — this
  is specifically about the existing pipeline tail behaving identically
  regardless of strategy).
- **O** (Jev route differs from Claude's, final = Claude, Jev preserved in
  trace): one test asserting both `decision.jev.route` and
  `decision.final.route` are present and different.
- **P** (cost aggregation): one test asserting `hybridMeta.totalEstimatedCostUsd`
  sums correctly for both the Jev-only and Jev+Claude cases.
- **Q** (latency/provenance): one test asserting `hybridMeta.initialLatencyMs`
  is present even when Jev fails, and `totalLatencyMs` exceeds either
  individual attempt when both providers were called.
- **R** (threshold validation): tests for `0`, `1` (valid boundaries), and
  out-of-range values (rejected).

---

## Dependencies proposed

**None.** Pure composition of already-existing, already-tested providers
and domain types.

---

## Fairness risks introduced by Hybrid (surfaced now, not left implicit)

1. **Hybrid's accuracy is not directly comparable to Jev-only or
   Claude-only accuracy** — it's a blend, by design (that's the entire
   research question). A future benchmark report must not present "Hybrid
   beat Jev-only" or "Hybrid beat Claude-only" as if they were competing on
   the same terms; they're answering different questions.
2. **Hybrid is structurally more expensive per fallback request** — any
   case that escalates costs Jev + Claude, strictly more than either alone.
   A benchmark claiming "Hybrid is cheaper" without accounting for the
   fallback rate would be misleading. This is an inherent property of the
   architecture, not a bug, but worth flagging so nobody's surprised by it
   later.
3. **The proposed `MISSING_CONFIDENCE_FALLBACK` case (pending your
   approval) would inflate the observed fallback rate for reasons unrelated
   to Jev's actual routing quality** — a real reason to track it as its own
   distinct category rather than quietly merging it into
   `UNCERTAINTY_FALLBACK`'s statistics.
4. **Fail-fast on configuration/account errors makes Hybrid benchmark runs
   more fragile, on purpose.** If Jev's account gets misconfigured mid-run
   (as happened twice for real, in Phase 4 and Phase 5), the entire Hybrid
   run fails outright rather than silently degrading into "Claude did all
   the work that day." This is the deliberate tradeoff your instruction
   asked for (transparency over resilience) — naming it so it's a known,
   accepted cost rather than a surprise during a future real run.

---

## Open questions requiring your decision

1. **`InvalidProviderOutputError`: fail-fast or fallback-eligible?**
   Recommending fail-fast (§4); not assumed.
2. **Missing-Jev-confidence behavior and the new `MISSING_CONFIDENCE_FALLBACK`
   reason** — recommending fallback-to-Claude with a new, distinct
   `EscalationReason` literal (§7); this is a domain-type addition and
   needs explicit sign-off, not silent implementation.
3. **New `HybridFallbackFailedError` domain error type** (§5) — a small,
   clearly-scoped addition to `src/domain/errors.ts`; flagging since any
   domain-error-taxonomy change has been an explicit approval point every
   time so far in this project.
4. **New `HybridMeta`/`Trace.hybridMeta` field** (§9) — the only proposed
   `Trace` shape change; everything else reuses existing fields.
5. **File location: `src/strategy/` (new top-level dir) vs.
   `src/pipeline/`** — a naming/organization preference, not load-bearing.
6. **The pre-existing `strategy: "MOCK"` hardcoding bug fix** (§9) —
   confirming you want this bundled into Phase 6 rather than treated as a
   separate, later fix, since Hybrid can't self-report correctly without it.

---

## Live Hybrid smoke-test record

**⚠ SMOKE TEST ONLY — NOT BENCHMARK EVIDENCE.** One request through the
real, implemented `decideHybrid()` path, made to validate the integration —
not to measure accuracy, cost, latency, or the right threshold. Not added
to `routing-v1.0.json`, and no comparative or quality conclusion should be
drawn from it.

**Configuration:**
- Prompt (from the dataset's own canonical cross-system example, used here
  only as a realistic, familiar smoke prompt — not scored against the
  frozen label): *"Check ENG-142 and find the code change that fixed it."*
- Strategy: `HYBRID`
- **Smoke-only threshold: `1.0`** — used solely to make the fallback path
  likely for this one test. **The source default (`DEFAULT_CONFIDENCE_THRESHOLD`)
  remains `0.80`, unchanged.** This was a per-request override, not a code
  change.

**Jev:**

| Field | Value |
|---|---|
| route | `GITHUB` |
| confidence | `0.98` |
| probabilities | `{GITHUB: 0.98, JIRA: 0.01, DIRECT_ANSWER: 0, DOCS: 0, REJECT: 0.01}` |
| latencyMs | `618` |
| inputTokens | `578` |
| outputTokens | `63` |
| estimatedCostUsd | `0.000024276` |
| providerReportedCostUsd | `0` |

**`providerReportedCostUsd: 0` is not interpreted as "Jev is free"** —
consistent with every prior report in this project, this reflects whatever
Vercel AI Gateway billed for this specific request (possibly promotional
pricing in effect at call time), not a claim about Jev's normal cost.

**Fallback:**
- `fallbackTriggered`: `true`
- `fallbackReason`: `UNCERTAINTY_FALLBACK`
- `threshold`: `1.0` (the smoke override — 0.98 < 1.0, so even Jev's
  near-maximum confidence didn't clear this deliberately unreachable bar)

**Claude:**

| Field | Value |
|---|---|
| route | `GITHUB` |
| latencyMs | `2597` |
| inputTokens | `1023` |
| outputTokens | `36` |
| estimatedCostUsd | `0.002406` |
| providerReportedCostUsd | `undefined` (Messages API returns no dollar-cost field — not fabricated) |

**Final:** provider = `claude`, route = `GITHUB`.

**Hybrid aggregate:** `totalLatencyMs = 3226`, `totalEstimatedCostUsd = 0.0024302760000000003`
(= `0.000024276 + 0.002406`, confirmed by hand; trailing floating-point
noise is harmless).

**Downstream:** `derivedAction = SEARCH_GITHUB_PR`, `policy = ALLOW`,
`execution = success` (5 mock PRs returned), `routingSpecVersion =
routing-spec-v1` on both provider decisions.

### The 11ms latency gap

Jev (618ms) + Claude (2597ms) = **3215ms** of measured provider time, but
`hybridMeta.totalLatencyMs` recorded **3226ms** — an **11ms difference**.
This demonstrates exactly why `decideHybrid()` measures its own wall-clock
independently rather than inferring total latency from the sum of provider
latencies (per the approved design, §9): the difference is orchestration
overhead (sequencing, validation, object construction between the two
calls). **This specific 11ms figure is not generalized beyond this one
smoke request** — it says nothing about typical overhead, only that
non-zero overhead genuinely exists and would have been invisible to a
naive "latency = sum of parts" implementation.

### Provider agreement — recorded carefully

Jev and Claude both selected `GITHUB` on this one prompt. **This is not
benchmark evidence and is not evidence of comparative accuracy.** Neither
provider is described as winning or outperforming the other here — a
single agreement (or disagreement) on one prompt establishes nothing about
either provider's general reliability.

### Methodological observation for Phase 7/8 (not a conclusion)

At the intentionally artificial threshold of 1.0, a Jev decision carrying
0.98 confidence — about as high as a confidence score gets — was escalated
to Claude anyway, and both providers agreed. **This does not mean the
fallback was unnecessary.** One case proves nothing about the fallback
mechanism's value in general. What it does motivate, for the real
benchmark (Phase 7/8), is measuring — not assuming — questions like:

- correct Jev decisions that fall below threshold (fallback triggered when
  it didn't need to be, from an accuracy standpoint)
- incorrect Jev decisions that fall below threshold (fallback triggered
  and useful)
- incorrect Jev decisions that remain above threshold (fallback *not*
  triggered, but should have been — the headline risk case)
- Claude's correction rate after a fallback (how often Claude fixes a
  wrong Jev call)
- Claude's regression rate after a fallback (how often Claude gets it
  wrong when Jev's low-confidence call was actually already correct)
- overall fallback rate
- cost impact of the fallback rate
- latency impact of the fallback rate

None of these are answerable from one smoke test — they're the actual
threshold-selection analysis Phase 7/8 exists to do.

### Trace behavior verified against the approved design

| Check | Observed |
|---|---|
| `strategy` | `HYBRID` ✓ |
| `decision.jev` | present ✓ |
| `decision.claudeFallback` | present, because fallback occurred ✓ |
| `decision.final` | the Claude decision ✓ |
| `escalation.threshold` | `1` ✓ |
| `escalation.triggered` | `true` ✓ |
| `escalation.reason` | `UNCERTAINTY_FALLBACK` ✓ |
| `hybridMeta.totalLatencyMs` / `.totalEstimatedCostUsd` | present ✓ |
| `hybridMeta.initialAttemptLatencyMs` | **absent, correctly** — a successful Jev `RoutingDecision` already carries `latencyMs`; this field only exists for the technical-failure case where no decision was produced |
| `hybridMeta.initialErrorCategory` | **absent, correctly** — Jev did not technically fail |

Every field matched the Phase 6A/6B design exactly — no discrepancy, no
code change needed or made.

### Policy boundary verified against the real run

```
Jev → Hybrid threshold evaluation → Claude fallback → final RoutingDecision
  → SEARCH_GITHUB_PR → deterministic Policy → ALLOW → mock execution
```

Neither Jev nor Claude authorized execution — `evaluatePolicy(action)`
received only the derived `Action` string, exactly as its signature has
guaranteed since Phase 1, with no path for a provider, confidence, or
strategy name to reach it. The **AI DECISION ENDS HERE** boundary (both
conceptually and in the UI) remains exactly where it was before this
smoke test — unchanged.
