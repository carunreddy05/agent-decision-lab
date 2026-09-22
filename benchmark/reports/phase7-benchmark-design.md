# Phase 7A — Benchmark Infrastructure Design Checkpoint (DESIGN ONLY, no implementation)

No code written. No provider call made. No benchmark run.
`routing-v1.0.json`, `routing-spec-v1`, `JevRouterProvider`,
`ClaudeRouterProvider`, Hybrid routing, policy, and `deriveAction` all
untouched.

---

## 1–2. Proposed architecture and files

Split pure/testable logic from the live-call entry point, extending the
Phase 3 pattern rather than replacing it (`src/benchmark/` already holds
`types.ts`/`validate.ts`/`hash.ts`/`load-dataset.ts`; `scripts/phase3-baseline.ts`
already establishes "pure logic in `src/`, thin script in `scripts/`, run
via `tsx`, never imported by the Next.js app" — the exact shape CLAUDE.md's
cost-safety rule requires for a benchmark runner).

```
src/benchmark/
  types.ts                    (existing — BenchmarkCase, BenchmarkDataset)
  validate.ts / hash.ts / load-dataset.ts   (existing, untouched)
  result-types.ts             (NEW — CaseResult discriminated union, RunManifest)
  pricing-config.ts           (NEW — versioned, re-exports existing provider pricing constants)
  case-runner.ts              (NEW — runs ONE case through ONE strategy, real or mocked provider)
  threshold-simulation.ts     (NEW — offline threshold analysis, see §17-18-21)
  manifest.ts                 (NEW — builds RunManifest: git commit/dirty, dataset hash, etc.)
  markdown-report.ts          (NEW — renders summary.md / threshold-analysis.md)
  limitations.ts              (NEW — the fixed limitations block, §24)
  metrics/
    accuracy.ts                (overall/route/difficulty/category, action, policy)
    latency.ts                 (mean/p50/p95, explicit failed-case handling)
    cost.ts                    (estimated vs. provider-reported, kept separate)
    usage.ts                   (token totals/means, per-provider)
    fallback.ts                (fallback counts/rates by reason, Claude call count)
    confusion-matrix.ts         (5x5 route confusion matrix, JSON + Markdown)

scripts/
  benchmark-runner.ts          (NEW — CLI entry point: arg parsing, dry-run, orchestration, writes artifacts)
  phase3-baseline.ts           (existing, untouched)

benchmark/
  datasets/routing-v1.0.json    (existing, untouched)
  reports/                      (existing research reports, untouched)
  results/                      (NEW, gitignored — run artifacts land here)
```

Everything under `src/benchmark/` is importable via `@/benchmark/...` and
directly unit-testable with vitest (matching `tests/benchmark/dataset.test.ts`'s
existing pattern). `scripts/benchmark-runner.ts` is the only place that
actually orchestrates a run end-to-end and is invoked via `tsx`, exactly
like `phase3-baseline.ts` — never part of `next build`/`next dev`.

---

## 3. Case-result schema

One shared `benchmarkSchemaVersion` (proposed: `"benchmark-schema-v1"`)
covers both the per-case result and the run manifest together, versioned
as a pair since they're always produced/consumed together.

```ts
interface CaseResultBase {
  benchmarkRunId: string;
  benchmarkSchemaVersion: string;
  timestamp: string;
  gitCommit: string;
  datasetVersion: string;
  datasetHash: string;
  routingSpecVersion: string;

  caseId: string;
  promptHash: string;        // sha256 of the prompt — see note below
  expectedRoute: Route;
  expectedAction?: Action;
  expectedPolicy?: PolicyResult;
  difficulty: BenchmarkDifficulty;
  category: string;

  succeeded: boolean;
  errorCategory?: string;    // safe class name only, present iff succeeded=false
}
```

**Note on `promptHash` vs. the raw prompt:** proposing to store only the
hash, not the prompt text itself, in each result row — the prompt is fully
recoverable from `caseId` against the locked dataset, and omitting it keeps
`cases.jsonl` smaller across repeated runs (JEV_ONLY + CLAUDE_ONLY +
however many HYBRID runs all reference the same 100 prompts). The hash
still lets us detect a dataset/result mismatch. Flagging as a choice, not
assuming it's obviously right — happy to store the raw prompt too if you'd
rather have it inline for readability.

**Per-strategy fields** (discriminated union on `strategy`):

```ts
interface JevOnlyCaseResult extends CaseResultBase {
  strategy: "JEV_ONLY";
  route?: Route; correctRoute?: boolean;
  confidence?: number; probabilities?: Partial<Record<Route, number>>;
  latencyMs?: number; inputTokens?: number; outputTokens?: number;
  estimatedCostUsd?: number; providerReportedCostUsd?: number;
  requestedModelIdentifier?: string; resolvedModelIdentifier?: string | null;
  derivedAction?: Action; actionCorrect?: boolean;
  policyResult?: PolicyResult; policyCorrect?: boolean;
}

interface ClaudeOnlyCaseResult extends CaseResultBase {
  strategy: "CLAUDE_ONLY";
  route?: Route; correctRoute?: boolean;
  // no confidence/probabilities fields at all — structurally absent, not
  // just optional-and-undefined, so "Claude has no such signal" is visible
  // in the type itself, not just in report prose.
  latencyMs?: number; inputTokens?: number; outputTokens?: number;
  estimatedCostUsd?: number; providerReportedCostUsd?: number;
  requestedModelIdentifier?: string; resolvedModelIdentifier?: string | null;
  derivedAction?: Action; actionCorrect?: boolean;
  policyResult?: PolicyResult; policyCorrect?: boolean;
}

interface HybridCaseResult extends CaseResultBase {
  strategy: "HYBRID";
  threshold: number;

  initialJevRoute?: Route; initialJevCorrect?: boolean;
  initialJevConfidence?: number; initialJevProbabilities?: Partial<Record<Route, number>>;
  jevLatencyMs?: number; jevInputTokens?: number; jevOutputTokens?: number;
  jevEstimatedCostUsd?: number; jevProviderReportedCostUsd?: number;
  initialErrorCategory?: string;

  fallbackTriggered: boolean;
  fallbackReason?: EscalationReason;   // reuses the existing domain enum

  claudeCalled: boolean;
  claudeRoute?: Route; claudeCorrect?: boolean;
  claudeLatencyMs?: number; claudeInputTokens?: number; claudeOutputTokens?: number;
  claudeEstimatedCostUsd?: number; claudeProviderReportedCostUsd?: number;

  finalRoute?: Route; finalCorrect?: boolean; finalProvider?: "jev" | "claude";
  totalLatencyMs?: number; totalEstimatedCostUsd?: number;

  // Factual, derived — no evaluative labels (§4):
  jevResolvedWithoutFallback: boolean;      // === !fallbackTriggered
  agreedWithClaude?: boolean;                // only meaningful when claudeCalled
  claudeCorrectedJev?: boolean;               // claudeCalled && initialJevCorrect===false && finalCorrect===true
  claudeRegressedJev?: boolean;               // claudeCalled && initialJevCorrect===true && finalCorrect===false

  derivedAction?: Action; actionCorrect?: boolean;
  policyResult?: PolicyResult; policyCorrect?: boolean;
}
```

`claudeCorrectedJev`/`claudeRegressedJev` are strictly computed booleans
(correct-before AND correct-after), not qualitative judgments like "good
fallback" — satisfying §4's "factual booleans only" without losing the
information needed for the corrections/regressions metric §21 asks for.

---

## 4. Run-manifest schema

```ts
interface RunManifest {
  benchmarkSchemaVersion: string;
  runId: string;
  timestamp: string;
  gitCommit: string;
  gitDirty: boolean;
  datasetVersion: string;
  datasetHash: string;
  routingSpecVersion: string;
  strategy: "JEV_ONLY" | "CLAUDE_ONLY" | "HYBRID";
  threshold?: number;                 // HYBRID only
  requestedModelIdentifiers: { jev?: string; claude?: string };
  pricingConfigVersion: string;
  requestedCaseCount: number;         // the --limit value, or 100
  actualCaseCount: number;
  fullDataset: boolean;               // true only if actualCaseCount === 100 and no limit applied
  dryRun: boolean;
  nodeVersion: string;
}
```

No secrets, ever — nothing here is derived from environment variable
*values*, only from git/dataset/config metadata. `gitDirty` comes from
`git status --porcelain` being non-empty; `gitCommit` from `git rev-parse
HEAD`, both shelled out from the standalone script (not the Next.js app, so
no sandboxing concern).

---

## 5. Pricing-config design

A thin, versioned **wrapper around already-existing provider pricing
constants** — not a parallel set of numbers that could drift from what
`JevRouterProvider`/`ClaudeRouterProvider` actually use to compute
`estimatedCostUsd` at decide-time:

```ts
export const PRICING_CONFIG_VERSION = "pricing-v1-2026-09-22";

export const PRICING_CONFIG = {
  version: PRICING_CONFIG_VERSION,
  jev: {
    inputPerMillionUsd: JEV_STANDARD_PRICE_PER_MILLION_INPUT_TOKENS_USD, // from src/providers/jev/config.ts
    outputPerMillionUsd: 0,
    source: JEV_PRICING_SOURCE,
  },
  claude: {
    model: CLAUDE_MODEL_ID,
    inputPerMillionUsd: CLAUDE_STANDARD_PRICE_PER_MILLION_INPUT_TOKENS_USD,
    outputPerMillionUsd: CLAUDE_STANDARD_PRICE_PER_MILLION_OUTPUT_TOKENS_USD,
    source: CLAUDE_PRICING_SOURCE,
  },
} as const;
```

The benchmark layer never recomputes cost from tokens × price itself — each
provider already does that at decide-time and the result is just carried
through on `estimatedCostUsd`. This config exists purely for **provenance**
(recording which pricing assumption was active) and for the few genuinely
new aggregate calculations (Claude subtotal, cost-per-fallback) that are
sums of already-computed per-case costs, not fresh price lookups. A future
price change creates `pricing-v2-...`, never edits `v1` in place — mirroring
the dataset-versioning discipline already established.

---

## 6–8. Accuracy, action, and policy scoring methodology

**Routing accuracy** (`metrics/accuracy.ts`): overall (`correct / total`,
denominator rule in §15), broken out by route/difficulty/category. For
Hybrid: final accuracy (using `finalRoute`), initial Jev accuracy (using
`initialJevRoute` — identical in principle to what a JEV_ONLY run on the
same cases would show), and Claude-fallback accuracy computed **only**
over cases where `claudeCalled === true` (not all 100 — accuracy "among
cases where Claude was called" is a different denominator than the full
set, and conflating them would misrepresent Claude's fallback-specific
performance).

**Action layer**: for cases with `expectedAction`, feed the strategy's
**final** route into the unchanged `deriveAction(finalRoute, prompt)`,
compare to `expectedAction`. `actionAnnotatedCount`/`actionCorrectCount`/
`actionAccuracy` reported, but `routeCorrect` and `actionCorrect` are two
fully independent booleans per case — the report can show "route correct
but action wrong" as its own slice (a `deriveAction` limitation, not a
provider routing failure), never blended into route accuracy.

**Policy layer**: `evaluatePolicy(derivedAction)` unchanged, compared to
`expectedPolicy` when annotated. `policyAnnotatedCount`/`policyCorrectCount`/
`policyAccuracy` — a third fully independent number. Route, action, and
policy accuracy are three separate figures in the report, never collapsed
into one "agent success" score, per your explicit instruction.

---

## 9–11. Latency, cost, and usage methodology

**Latency** (`metrics/latency.ts`): mean/p50/p95 per strategy. For Hybrid,
computed separately for Jev-attempt latency (all cases), Claude-attempt
latency (only `claudeCalled` cases), and total Hybrid latency (only from
**genuine live Hybrid runs** — see §17-18-21 for why offline-simulated
threshold data must not feed this metric). **Failed cases**: proposing to
**exclude** them from mean/p50/p95 (a failed request's near-instant
fail-fast or absent latency would skew "typical successful call" stats),
while always reporting `excludedFailedCount` alongside so the exclusion is
visible, never silent. Flagging this as a methodology choice needing your
confirmation, not assumed.

**Cost** (`metrics/cost.ts`): `estimatedCostUsd` and `providerReportedCostUsd`
always reported as two separate numbers, never combined. Per strategy: total
and mean estimated cost. For Hybrid: Jev subtotal, Claude subtotal, total,
mean/request, and cost-per-fallback (`Claude subtotal / fallback count` —
the marginal cost specifically attributable to escalating). A `$0`
`providerReportedCostUsd` is reported as exactly that — "Gateway reported
$0," never "free," matching every prior report in this project.

**Usage** (`metrics/usage.ts`): input/output token totals and means, kept
per-provider for Hybrid (`jev` and `claude` usage never merged into one
blended count).

---

## 12–13. Fallback metrics and threshold analysis

**Fallback metrics** (`metrics/fallback.ts`): per threshold, total cases,
fallback count/rate, broken out by `UNCERTAINTY_FALLBACK`/
`MISSING_CONFIDENCE_FALLBACK`/`TECHNICAL_FAILURE_FALLBACK`, plus Claude call
count. No success/failure judgment attached to the fallback event itself —
purely counts and rates.

**Threshold analysis** (`threshold-simulation.ts` + a metrics layer over
it): for each of {0.60, 0.70, 0.80, 0.90, 0.95}, report final accuracy,
fallback count/rate, Claude call count, total/mean estimated cost, correct-
Jev-escalated / incorrect-Jev-escalated / incorrect-Jev-not-escalated
counts, and Claude corrections/regressions after fallback. **No automatic
ranking, no "best threshold" output** — the report lists five columns of
tradeoffs side by side and stops there.

---

## 14. Confusion matrix

`metrics/confusion-matrix.ts`: a 5×5 matrix (rows = expected route, columns
= observed route, over `DIRECT_ANSWER`/`DOCS`/`GITHUB`/`JIRA`/`REJECT`) for
JEV_ONLY, CLAUDE_ONLY, and HYBRID-final-route. Emitted as both a plain JSON
object (`confusion-matrix.json`) and a rendered Markdown table inside
`summary.md`.

---

## 15. Failure handling and the accuracy denominator

A failed case (provider threw) still produces a full `CaseResult` row —
`succeeded: false`, `errorCategory` set, all provider-specific fields left
`undefined` — **never dropped** from `cases.jsonl`.

**Proposed denominator rule** (your instruction's own recommendation,
restated for explicit sign-off rather than silently adopted): a failed
case counts as **not correct** in the accuracy denominator
(`overallAccuracy = correctCount / totalCases`, failures included in
`totalCases`), while `failureCount`/`failureRate` are always reported
alongside as their own explicit numbers — so a reader can always tell "the
provider was wrong" apart from "the provider couldn't produce an answer at
all," never conflated into a single opaque accuracy figure.

**Safe error extraction**: reusing the exact same pattern already built for
Jev/Claude diagnostic logging (`error.constructor.name` for category, the
`extractSafeMessage`-style nested-field extraction already fixed once
during Phase 5C) rather than writing a second, potentially less careful
error-parsing path for the benchmark runner. Never a raw provider body, key,
or header.

---

## 16. Reproducibility fields

Covered in full in §4 (`RunManifest`). `gitDirty` triggers a console
warning before any non-dry-run execution (the actual live-run gating is a
later-phase concern, but the check itself is built and tested now, per the
project's consistent pattern of building safety checks before they're
needed).

---

## 17–18, 21. Threshold analysis: live vs. offline — the single biggest design decision here

Your instruction is explicit that five separate live Hybrid runs (one per
threshold) would be wasteful if the same underlying decisions can be
reused — and equally explicit that doing so must not silently distort
latency/cost/failure behavior. Working through this carefully:

**Key realization: `CLAUDE_ONLY` already requires a full 100-case Claude
run as one of the three core comparison modes (§1).** Since `JEV_ONLY`
similarly requires a full 100-case Jev run, we already have — for free,
with zero *additional* calls beyond what the three core modes need anyway —
a cached Jev decision and a cached Claude decision for every one of the 100
cases. **Every one of the five thresholds' fallback behavior is fully
determined by a single case's Jev confidence value** (or its failure
state), which we already have from the JEV_ONLY run. So:

**A. Offline threshold simulation** (`threshold-simulation.ts`): reuses the
cached `JEV_ONLY` and `CLAUDE_ONLY` result sets. For each case and each
threshold, determine whether that threshold's fallback logic *would* have
triggered (using the case's actual cached Jev confidence/failure state),
and if so, use the cached Claude decision as final for that
threshold+case combination. This correctly reconstructs, per threshold:
final route accuracy, fallback rate/reason breakdown, Claude call count,
correction/regression rates, and **cost** (summing only the Jev cost always
+ Claude cost for cases that threshold would have escalated) — all of these
depend only on *which decision became final and what it cost*, not on live
orchestration timing, so reconstructing them from cached data is
methodologically sound, not a shortcut that distorts the numbers.

**What this must NOT be used for: `totalLatencyMs`.** A genuine live
`decideHybrid()` call measures real sequential wall-clock, including
orchestration overhead between the Jev and Claude calls — Phase 6's own
smoke test measured an 11ms gap between measured total latency and the sum
of the two provider latencies, precisely the kind of thing that can't be
reconstructed by adding two independently-run numbers together. Offline
simulation would either have to omit total-Hybrid-latency entirely or
falsely present `jevLatencyMs + claudeLatencyMs` as if it were a measured
total — the latter is exactly the distortion your instruction warns
against.

**B. A small number of genuine live Hybrid runs**, run through the actual
`decideHybrid()` function with no reconstruction, reserved specifically for
real measured `totalLatencyMs` at a given threshold (most likely just the
default 0.80, or whichever threshold(s) you want real timing for later).
These are never blended with the offline-simulated accuracy/cost/fallback
numbers in one output — the report clearly separates "threshold tradeoff
analysis (simulated from cached decisions)" from "measured Hybrid latency
(from N live requests at threshold X)," and the artifacts/manifests make
which mode produced which data explicit rather than implicit.

**Approved with refinement**: a Jev *technical* failure observed in the
JEV_ONLY baseline is a time-dependent runtime observation and does not
prove the same failure would recur on a genuine live Hybrid call. Such
cases are marked `simulationStatus: "NOT_RECONSTRUCTABLE_TECHNICAL_FAILURE"`,
excluded from the `reconstructableCases` denominator, and counted
separately as `nonReconstructableTechnicalFailureCount` — never silently
substituted with the cached Claude decision. A Claude-baseline failure
encountered *after* a fallback decision already determined from Jev's own
successful, cached confidence is a different case: the fallback decision
itself is still fully reconstructable, so that case stays in the
reconstructable set and is simply scored not-correct (the ordinary
failed-case accuracy rule from §15).

---

## 19. Output artifact structure

```
benchmark/results/
  <run-id>/
    manifest.json
    cases.jsonl
    summary.json
    summary.md
    confusion-matrix.json
    threshold-analysis.json      (only produced from an offline-simulation pass)
    threshold-analysis.md
```

`run-id` format: `YYYYMMDD-HHmmss-<strategy>[-t<threshold*100>]`, e.g.
`20260922-114500-hybrid-t080` — human-scannable in a directory listing.

**Not committed automatically** — `/benchmark/results/` added to
`.gitignore`, leaving the hand-curated `benchmark/datasets/` and
`benchmark/reports/` untouched.

---

## 20. Dry-run behavior

Loads the dataset, validates CLI config (strategy/threshold/limit), and
reports: case count that would run (respecting `--limit`), which
providers would be called, and an honest **maximum** possible call count —
for a live single-threshold Hybrid dry-run, the exact Claude call count
genuinely can't be known ahead of time (it depends on real confidence
values not yet observed), so dry-run reports "up to N possible Claude
calls," never a fabricated precise number. Prints pricing assumptions from
the active `PRICING_CONFIG`. Makes **zero** provider calls and writes **no**
result artifacts — dry-run only prints/returns a plan.

## Case-limit behavior

`--limit N` takes a deterministic prefix of the loaded dataset (first N
cases in dataset order — not randomly sampled, for full reproducibility).
Manifest always records `requestedCaseCount`, `actualCaseCount`, and
`fullDataset` (true only when no limit was applied and all 100 ran) — the
generated Markdown report also gets a prominent "PARTIAL RUN — N/100
cases" banner whenever `fullDataset` is false.

## Strategy selection (CLI)

```
npm run benchmark -- --strategy jev --dry-run
npm run benchmark -- --strategy claude --limit 5 --dry-run
npm run benchmark -- --strategy hybrid --threshold 0.8 --dry-run
npm run benchmark -- --strategy threshold-simulation --jev-run <dir> --claude-run <dir>
```

Parsed with Node's built-in `node:util` `parseArgs` — no new dependency.
`--strategy` accepts only `jev`/`claude`/`hybrid`/`threshold-simulation`
(never `mock`).

---

## 22. Human-readable report

`markdown-report.ts` renders `summary.md`/`threshold-analysis.md` with
exactly the sections in your instruction. Plain template-literal
rendering — no new templating dependency.

---

## 23. Limitations block

A fixed, reusable constant (`src/benchmark/limitations.ts`) appended to
every generated report.

---

## 24. Test plan

All mocked — zero real provider calls anywhere in the test suite. See the
Phase 7B checkpoint below for the final list and count.

---

## 25. Dependencies proposed

**None.** `node:util`'s `parseArgs` for CLI flags, `node:crypto` for
`promptHash`, plain template literals for Markdown — nothing new in
`package.json`.

---

## 26. `.gitignore` changes proposed

Add `/benchmark/results/` — leaves `benchmark/datasets/` and
`benchmark/reports/` unaffected.

---

## 27. Fairness / measurement risks

1. Offline-simulated threshold data must never be presented as measured
   latency (see §17-18-21).
2. JEV_ONLY and CLAUDE_ONLY baselines run at different times — network/
   provider load conditions aren't identical between the two runs.
3. A `$0` `providerReportedCostUsd` must never read as "Jev is free."
4. A `--limit`-restricted run must never be mistaken for the full result.
5. "High-confidence error" has no single correct threshold — raw confidence
   is preserved and queried at multiple cutoffs (0.80/0.90/0.95).

---

---

# PHASE 7B — Implementation checkpoint

Phase 7A design approved with refinements (offline-threshold reconstruction
rules, `simulated*`-prefixed field naming, `analysisMode:
"OFFLINE_THRESHOLD_SIMULATION"` tagging, non-reconstructable technical-
failure handling, failed-case accuracy/latency rules). Implemented exactly
as approved. **Zero live Jev/Claude calls were made during this phase.**

## 1. Files created/modified

**Created (`src/benchmark/`):**
`result-types.ts`, `pricing-config.ts`, `prompt-hash.ts`, `manifest.ts`,
`case-runner.ts`, `threshold-simulation.ts`, `markdown-report.ts`,
`limitations.ts`, `cli.ts`, `jsonl.ts`,
`metrics/{accuracy,latency,cost,usage,fallback,confusion-matrix}.ts`.

**Created (script):** `scripts/benchmark-runner.ts`.

**Created (tests, 15 files):** `tests/benchmark/{pricing-config,prompt-hash,
jsonl,case-runner,manifest,cli,markdown-report,threshold-simulation}.test.ts`
+ `tests/benchmark/metrics/{accuracy,latency,cost,usage,fallback,
confusion-matrix}.test.ts`.

**Modified:** `package.json` (added `"benchmark": "tsx
scripts/benchmark-runner.ts"`), `.gitignore` (added `/benchmark/results/`).

**Untouched (verified via `git diff --stat`):** `src/providers/`,
`src/strategy/`, `src/pipeline/`, `src/policy/`,
`benchmark/datasets/routing-v1.0.json`.

## 2. Benchmark runner architecture

Pure logic lives in `src/benchmark/` (importable via `@/benchmark/...`,
directly unit-testable). `scripts/benchmark-runner.ts` is the thin
orchestration/CLI entry point (tsx, standalone, never imported by the
Next.js app) — mirrors `scripts/phase3-baseline.ts`'s existing pattern.

## 3. CLI commands implemented

```
npm run benchmark -- --strategy jev --dry-run
npm run benchmark -- --strategy claude --limit 5 --dry-run
npm run benchmark -- --strategy hybrid --threshold 0.8 --dry-run
npm run benchmark -- --strategy threshold-simulation --jev-run <dir> --claude-run <dir> [--thresholds 0.6,0.8] --dry-run
```

`--strategy` accepts only `jev`/`claude`/`hybrid`/`threshold-simulation`
(rejects `mock`). `--threshold` only valid with `hybrid` (defaults to 0.8).
`--thresholds` only valid with `threshold-simulation` (defaults to
0.6/0.7/0.8/0.9/0.95). `--limit` must be a positive integer. Parsed via
`node:util.parseArgs` — no new dependency.

## 4. Case-result schema

Implemented exactly as designed in §3 above: `JevOnlyCaseResult` /
`ClaudeOnlyCaseResult` / `HybridCaseResult` discriminated union in
`result-types.ts`, `benchmarkSchemaVersion: "benchmark-schema-v1"`.
`ClaudeOnlyCaseResult` has no `confidence`/`probabilities` fields at all
(structurally absent — verified by test: `"confidence" in result` is
`false`, not `undefined`). Every result stores `promptHash`
(`prompt-hash.ts`, sha256 of exact UTF-8 prompt bytes) — never the raw
prompt (verified by a test that asserts the serialized result never
contains prompt text).

## 5. Manifest schema

Implemented exactly as designed in §4 above (`manifest.ts`). `getGitCommit`/
`isGitDirty` shell out to git via `execFileSync`, never throw (degrade to
`"UNKNOWN"`/`false` on failure), and never touch environment variable
values. `buildRunId(strategy, threshold, now)` produces
`YYYYMMDD-HHmmss-<strategy>[-t<threshold*100>]`.

## 6. Pricing config

`pricing-config.ts`: `PRICING_CONFIG_VERSION = "pricing-v1-2026-09-22"`,
wraps (does not duplicate) `JEV_STANDARD_PRICE_PER_MILLION_INPUT_TOKENS_USD`
and the Claude equivalents from each provider's own `config.ts`. Verified
by test that `PRICING_CONFIG.jev.inputPerMillionUsd === 
JEV_STANDARD_PRICE_PER_MILLION_INPUT_TOKENS_USD` (same constant, not a
copied number).

## 7. Actual strategy execution behavior

`case-runner.ts` provides `runJevOnlyCase`/`runClaudeOnlyCase`/
`runHybridCase`, each taking an injected `RouterProvider` (or two, for
Hybrid) plus a `CaseRunnerContext` (run-level provenance). Each feeds the
strategy's **final** route into the unchanged `deriveAction`/
`evaluatePolicy` for action/policy scoring. `runHybridCase` calls the
unmodified `decideHybrid()` — no Hybrid behavior was touched.

## 8. Failure methodology

A provider/strategy failure produces a full result row with `succeeded:
false` and `errorCategory` (a safe class name, e.g. `"ProviderTimeoutError"`
or `"HybridFallbackFailedError"`) — never a dropped/missing row. Verified
by tests for Jev, Claude, and both Hybrid failure paths (fail-fast before
fallback, and `HybridFallbackFailedError` after fallback).

## 9. Accuracy methodology

`metrics/accuracy.ts`: `computeRouteAccuracy` — a failed case counts as
not-correct in every denominator (overall/byRoute/byDifficulty/byCategory),
`failureCount`/`failureRate` always reported separately.
`computeLayerAccuracy` — action/policy accuracy over annotated cases only,
fully independent of route accuracy.

## 10. Latency methodology

`metrics/latency.ts`: mean/p50/p95 computed from successful samples only;
`providerFailureCount`, `failedAttemptLatencySampleCount`, and
`failedAttemptLatencyMeanMs` always reported alongside, never mixed into
the successful-sample percentiles (verified by test).

## 11. Cost methodology

`metrics/cost.ts`: `estimatedCostUsd` and `providerReportedCostUsd` kept as
two separate totals; an explicit `providerReportedCostUsd: 0` is treated as
a real reported value (sample count 1), while an absent one is `undefined`
with sample count 0 — never conflated (verified by test). Hybrid gets its
own `computeHybridCostStats` with Jev/Claude subtotals and
`costPerFallbackUsd`.

## 12. Usage methodology

`metrics/usage.ts`: token totals/means, sample count excludes rows with no
usage at all. Kept per-provider for Hybrid by the caller (Jev and Claude
usage never merged).

## 13. Route/action/policy scoring

Three fully independent fields/summaries per case and per run, as designed
in §6-8/§11 above — verified structurally (separate `LayerAccuracySummary`
objects) and via the case-runner tests showing a route mismatch does not
change action/policy scoring math.

## 14. Confusion matrix

`metrics/confusion-matrix.ts`: 5×5 `matrix[expected][observed]` plus a
separate `failureColumn` — a provider failure is never silently mapped onto
REJECT (verified by test: a failed DOCS case increments `failureColumn.DOCS`
and leaves `matrix.DOCS.REJECT` at 0).

## 15. Threshold simulation implementation

`threshold-simulation.ts`, `simulateThreshold(jevResults, claudeResults,
threshold)`: pure function over two cached result arrays, matched by
`caseId`. Zero provider-related imports (verified by a source-inspection
test checking every `import` line). Every output field is tagged
`analysisMode: "OFFLINE_THRESHOLD_SIMULATION"` and named with a
`simulated`/`jev`/`claude` prefix (verified: `"simulatedFinalRoute" in
result` true, `"finalRoute" in result` and `"totalLatencyMs" in result`
both false). No latency field exists anywhere in its output (verified by a
test asserting the serialized table has no `latency`-labeled column).

## 16. Technical-failure treatment in simulation

A Jev technical failure in the JEV_ONLY baseline → `simulationStatus:
"NOT_RECONSTRUCTABLE_TECHNICAL_FAILURE"`, excluded from
`reconstructableCases`, counted in `nonReconstructableTechnicalFailureCount`
— never silently given a substituted Claude decision (verified by test). A
Claude-baseline failure encountered *after* a valid, cached Jev-confidence-
driven fallback decision stays in the reconstructable set and is scored
not-correct (the ordinary failed-case rule) — verified by a dedicated test
distinguishing the two cases.

## 17. Output artifacts

`scripts/benchmark-runner.ts` writes, per real (non-dry-run) provider
strategy run: `manifest.json`, `cases.jsonl` (one JSON object per line, via
`jsonl.ts`), `summary.json`, `summary.md`, `confusion-matrix.json`. For
`threshold-simulation`: `threshold-analysis.json`, `threshold-analysis.md`.
All under `benchmark/results/<run-id>/`. **No such directory was created
during this phase** (only `--dry-run` was ever executed).

## 18. Dry-run behavior

Verified live (see §24 below): makes zero provider calls, loads and
validates the dataset, prints a JSON plan (case counts, providers that
would be called, max possible provider-call count, pricing config version,
output destination, git commit/dirty), writes no files.

## 19. Case-limit behavior

`--limit N` takes a deterministic prefix (`dataset.cases.slice(0, N)`).
Manifest and dry-run plan both record `requestedCaseCount`,
`actualCaseCount`, `fullDataset`. `renderRunSummaryMarkdown` shows a
"PARTIAL RUN" banner whenever `fullDataset` is false (verified by test);
no banner for a full run (also verified).

## 20. Reproducibility metadata

`RunManifest` includes every field listed in the approved design:
`benchmarkSchemaVersion`, `runId`, `timestamp`, `gitCommit`, `gitDirty`,
`datasetVersion`, `datasetHash`, `routingSpecVersion`, `strategy`,
`threshold` (Hybrid only), `requestedModelIdentifiers`,
`pricingConfigVersion`, `requestedCaseCount`, `actualCaseCount`,
`fullDataset`, `dryRun`, `nodeVersion`. No credentials — verified by a test
asserting the serialized manifest never matches an API-key-shaped pattern.

## 21. Tests added

15 new test files, all mocked/pure — no real provider calls:

- `tests/benchmark/pricing-config.test.ts` (3 tests)
- `tests/benchmark/prompt-hash.test.ts` (4 tests)
- `tests/benchmark/jsonl.test.ts` (2 tests)
- `tests/benchmark/case-runner.test.ts` (13 tests) — success/failure paths
  for all three strategies, HybridFallbackFailedError, fail-fast Jev error,
  claudeCorrectedJev/claudeRegressedJev, promptHash-only persistence
- `tests/benchmark/manifest.test.ts` (6 tests) — runId format, no-secrets
  check, threshold-only-on-Hybrid, fullDataset flag, never-throws git calls
- `tests/benchmark/cli.test.ts` (15 tests) — strategy validation (mock
  rejected), threshold/limit validation, threshold-simulation requirements,
  dry-run plan for all four strategies including max-call estimation
- `tests/benchmark/markdown-report.test.ts` (6 tests) — required sections,
  no winner/best-threshold language, partial-run banner
- `tests/benchmark/threshold-simulation.test.ts` (17 tests) — the core
  reconstruction logic, non-reconstructable technical failure, Claude-
  baseline-failure-after-valid-fallback distinction, cost/naming/latency-
  absence guarantees, caseId-based matching, zero-provider-call structural
  guarantee
- `tests/benchmark/metrics/accuracy.test.ts` (6 tests)
- `tests/benchmark/metrics/latency.test.ts` (4 tests)
- `tests/benchmark/metrics/cost.test.ts` (5 tests)
- `tests/benchmark/metrics/usage.test.ts` (3 tests)
- `tests/benchmark/metrics/fallback.test.ts` (2 tests)
- `tests/benchmark/metrics/confusion-matrix.test.ts` (5 tests)

## 22. Total test count

**246 tests passing** (159 pre-existing + 87 new), across 26 test files.

## 23. Typecheck/lint/build

- `npm run typecheck` — clean, no errors.
- `npm run lint` — clean, no errors/warnings (one `prefer-const` error and
  one unused-import warning were caught and fixed during implementation).
- `npm run build` — succeeds (`next build`, Turbopack, all routes compile).

## 24. Dry-run examples/results

Ran all four dry-run modes live (zero provider calls, zero files written):

```
$ npx tsx scripts/benchmark-runner.ts --strategy jev --dry-run
{ "strategy": "jev", "actualCaseCount": 100, "fullDataset": true,
  "providersThatWouldBeCalled": ["jev"], "maxPossibleProviderCalls": 100, ... }

$ npx tsx scripts/benchmark-runner.ts --strategy claude --limit 5 --dry-run
{ "strategy": "claude", "actualCaseCount": 5, "fullDataset": false,
  "maxPossibleProviderCalls": 5, ... }

$ npx tsx scripts/benchmark-runner.ts --strategy hybrid --threshold 0.8 --dry-run
{ "strategy": "hybrid", "threshold": 0.8, "actualCaseCount": 100,
  "providersThatWouldBeCalled": ["jev","claude"],
  "maxPossibleProviderCalls": { "jev": 100, "claude": 100, "total": 200 }, ... }

$ npx tsx scripts/benchmark-runner.ts --strategy threshold-simulation \
    --jev-run /tmp/fake-jev --claude-run /tmp/fake-claude --dry-run
{ "strategy": "threshold-simulation", "thresholds": [0.6,0.7,0.8,0.9,0.95],
  "providersThatWouldBeCalled": [], "maxPossibleProviderCalls": 0, ... }
```

`benchmark/results/` does not exist on disk after these runs — dry-run
wrote nothing, confirmed.

## 25. Dataset hash

`d3617240469f7b560e0d78adf9bee7afb500d8ccc650d9eac39bc76f7b952856` —
unchanged, reconfirmed via `tests/benchmark/dataset.test.ts` (11/11 passing)
and independently via every dry-run's printed `datasetHash`.

## 26. Baseline confirmation

Re-ran `npm run benchmark:baseline`:
- deriveAction: **75/79 = 94.9%** (unchanged)
- MockRouterProvider: **49/100 = 49.0%** (unchanged)

## 27. Dependency changes

**None.** `package.json` dependencies/devDependencies are byte-identical;
only a new `"benchmark"` script entry was added.

## 28. Gitignore behavior

Added `/benchmark/results/` only. `benchmark/datasets/`, `benchmark/reports/`,
and all benchmark source code remain tracked/committable as before.

## 29. Confirmation: zero live provider calls

Confirmed. No `JevRouterProvider`/`ClaudeRouterProvider` instance was ever
constructed with real credentials during this phase — every test uses a
stub `RouterProvider`, and the only `scripts/benchmark-runner.ts`
executions performed were `--dry-run` (which never imports/constructs a
real provider path — `printDryRunPlan` only calls `loadDataset` and
`hashDataset`). `.env.local` remains gitignored and unstaged throughout.

## 30. Git status

```
 M .gitignore
 M package.json
?? benchmark/reports/phase7-benchmark-design.md
?? scripts/benchmark-runner.ts
?? src/benchmark/case-runner.ts
?? src/benchmark/cli.ts
?? src/benchmark/jsonl.ts
?? src/benchmark/limitations.ts
?? src/benchmark/manifest.ts
?? src/benchmark/markdown-report.ts
?? src/benchmark/metrics/
?? src/benchmark/pricing-config.ts
?? src/benchmark/prompt-hash.ts
?? src/benchmark/result-types.ts
?? src/benchmark/threshold-simulation.ts
?? tests/benchmark/ (new files)
```

`src/providers/`, `src/strategy/`, `src/pipeline/`, `src/policy/`, and
`benchmark/datasets/routing-v1.0.json` show no diff — verified via
`git diff --stat` immediately before this report.

## 31. Proposed Phase 7 commit message

```
feat: build Phase 7 benchmark infrastructure (runner, metrics, offline threshold simulation)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```

(Not committed — waiting for your explicit approval per standing
instructions.)

## 32. Deviations/unresolved concerns

- None from the approved Phase 7A design. One implementation-level judgment
  call made without a separate approval gate, flagged here for visibility:
  when a Hybrid fallback triggers but the *Claude baseline call itself*
  fails during offline threshold simulation (not a Jev failure), that case
  is scored not-correct and kept in the reconstructable set rather than
  marked non-reconstructable — reasoning given in §17-18-21's closing
  paragraph above. Happy to revisit if you'd prefer a different treatment.
- The `threshold-simulation` CLI mode reads `cases.jsonl` from two
  already-completed run directories (`--jev-run`/`--claude-run`) rather
  than any other file-selection scheme — this has not yet been exercised
  end-to-end against a real run directory (since no real run has been
  made), only against the pure `simulateThreshold` function directly in
  tests. Worth a quick sanity check once real JEV_ONLY/CLAUDE_ONLY runs
  eventually exist.

---

# PHASE 7 CLOSURE

## §32 decision — approved and confirmed already implemented

The §32 judgment call flagged in the Phase 7B checkpoint is **approved as
the standing rule**, with the exact behavior specified below. Verified
against `threshold-simulation.ts` — the implementation already matched
this rule when it was written, so **no code change was made**; this
section only records the rule as now explicitly locked-in policy rather
than an implementation detail that happened to be defensible.

**Rule: valid Jev decision + threshold requires fallback + Claude baseline
failure → reconstructable simulated Hybrid case:**

- `simulationStatus: "RECONSTRUCTED"` (not `NOT_RECONSTRUCTABLE_TECHNICAL_FAILURE`)
- `simulatedClaudeCalled: true`, `claudeSucceeded: false` — the Claude
  failure is preserved explicitly, never hidden or dropped
- `simulatedFinalRoute: undefined` — never converted to `REJECT` and never
  resurrects Jev's own (already-distrusted) route
- `simulatedFinalCorrect: false` — scored not-correct, the same failed-case
  rule used everywhere else in this benchmark (§15)
- Included in the `reconstructableCases` denominator, and therefore in
  `simulatedFinalAccuracy`

**Rule: Jev transient technical failure → `NOT_RECONSTRUCTABLE_TECHNICAL_FAILURE`:**

- Excluded from `reconstructableCases` entirely
- Counted separately in `nonReconstructableTechnicalFailureCount`
- No simulated final route/correctness/cost is computed for it at all

**Why these are different:** the two failures sit on opposite sides of the
one thing offline simulation is actually allowed to reconstruct — *the
fallback decision itself*. A threshold's fallback/no-fallback choice is a
pure function of Jev's own cached, already-observed confidence value (or
its absence); nothing about a *Claude* failure changes whether that
decision was correct or reconstructable — Claude's role only begins once
the decision to escalate has already been made, so a Claude failure is
just an ordinary failed outcome for the case that was already, correctly,
routed to Claude. A **Jev** technical failure is a different kind of gap:
it prevents the fallback decision from ever being determined in the first
place, since there is no confidence value to threshold against — and
because provider technical failures (timeouts, rate limits, transient
unavailability) are time-dependent runtime conditions, nothing licenses
the assumption that Jev would fail again, identically, on a hypothetical
live Hybrid call made at a different moment. Reconstructing a fallback
decision that was never actually made would be fabrication; scoring an
already-made decision's downstream Claude failure is not.

## 1. Final verification

- `npm test`: **246/246 passing** (unchanged from the Phase 7B checkpoint —
  no new tests were needed for closure-only documentation).
- `npm run typecheck`: clean.
- `npm run lint`: clean.
- `npm run build`: succeeds (Next.js 16.3.5 / Turbopack, all routes compile).

## 2. Dry-run verification (all four modes, zero provider calls)

Ran `--strategy jev`, `--strategy claude`, `--strategy hybrid --threshold
0.8`, and `--strategy threshold-simulation --jev-run <fake> --claude-run
<fake>`, all with `--dry-run`. Every plan printed
`datasetHash: "d3617240469f7b560e0d78adf9bee7afb500d8ccc650d9eac39bc76f7b952856"`,
reported the correct provider set and max-call estimate per strategy
(jev: 100, claude: 100, hybrid: {jev:100, claude:100, total:200},
threshold-simulation: 0), and wrote no files — `benchmark/results/` does
not exist on disk afterward.

## 3. Dataset hash

`d3617240469f7b560e0d78adf9bee7afb500d8ccc650d9eac39bc76f7b952856` —
confirmed unchanged via `tests/benchmark/dataset.test.ts` (11/11 passing)
and independently via all four dry-run outputs above.

## 4. Baseline verification

- deriveAction: **75/79 = 94.9%** (unchanged)
- MockRouterProvider: **49/100 = 49.0%** (unchanged)

## 5. Zero diff confirmation

`git diff --stat -- src/providers src/strategy src/pipeline src/policy
benchmark/datasets` returns empty — `routing-spec-v1`
(`src/providers/routing-spec.ts`), `JevRouterProvider`,
`ClaudeRouterProvider`, Hybrid routing, policy, and the locked dataset are
all byte-identical to before Phase 7 began.

## 6. Secret / artifact check

- `.env.local` remains gitignored (`git check-ignore -v .env.local` →
  matched by `.gitignore:34:.env*`) and was never staged.
- No credentials appear in any tracked file (manifests/results contain only
  git/dataset/config metadata, never environment variable values).
- `benchmark/results/` is gitignored as designed; it does not exist on disk
  (no fake or real benchmark results were ever generated).
- `benchmark/datasets/`, `benchmark/reports/`, and all new benchmark source
  files remain tracked/committable.
- Zero live Jev or Claude API calls occurred at any point in Phase 7 —
  every test uses a stub `RouterProvider`, and the only
  `scripts/benchmark-runner.ts` executions performed were `--dry-run`.

## 7. Commit

Committed as Phase 7. See the top-level session report for the commit
hash and final git status.

**Phase 7 is closed. Phase 8 has not been started.**
