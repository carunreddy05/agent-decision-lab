# Benchmark Summary

The canonical, readable results document for Agent Decision Lab's
provider benchmark. For full per-case detail, methodology derivations,
and raw numbers behind every figure here, see the phase reports linked at
the bottom — this document summarizes them, it does not replace them.

No provider is ranked here. No threshold is selected here.

## Research Questions

1. Does every bounded routing decision inside an AI agent require a
   general-purpose LLM, or can a specialized decision model handle
   routine cases while escalating uncertain ones?
2. Where should probabilistic AI decision-making end and deterministic
   software control begin?

## Dataset

`benchmark/datasets/routing-v1.0.json` — 100 synthetic, human-reviewed
routing cases, frozen at version `1.0` before any real-provider
benchmarking. SHA-256: `d3617240469f7b560e0d78adf9bee7afb500d8ccc650d9eac39bc76f7b952856`.
Difficulty levels: `CLEAR`, `MODERATE`, `AMBIGUOUS`. Routes:
`DIRECT_ANSWER`, `DOCS`, `GITHUB`, `JIRA`, `REJECT`.

## Methodology

- Same frozen dataset and routing instructions (`routing-spec-v1`) for
  every provider.
- Ground truth locked before seeing any real-provider result; no
  relabeling after the fact.
- No selective retry of an individual case within a scored baseline; no
  patching a failed case into an already-completed run; no dropped cases
  — a technical failure is recorded as a technical failure, in full, in
  the result artifact.
- Route, action, and policy accuracy scored as three independent numbers,
  never blended into one "agent accuracy."
- Raw prompt text is never persisted in a result artifact — only a hash,
  checkable against the frozen dataset.
- Every provider's output is normalized behind one shared
  `RouterProvider` interface before anything downstream sees it.
- A live smoke test and a small pacing-validation run are both explicitly
  excluded from benchmark evidence — neither is scored as a routing
  result.
- **The Jev baseline's real procedure:** the first full unpaced attempt
  hit provider-side rate limiting (70/100 requests rejected). That run
  (`20260922-165700-jev-only`) was preserved exactly as recorded, never
  edited or discarded. After investigating the cause, a **separate,
  complete new baseline** (`20260922-174506-jev-only`) was run from case
  1 through case 100 under a fixed pacing configuration decided *before*
  its first request — not a selective retry of the 70 that failed. Both
  Jev artifacts remain distinct; they were never merged into a synthetic
  combined result.

## Provider Baselines

| | Jev | Claude |
|---|---|---|
| Run ID | `20260922-174506-jev-only` | `20260922-165824-claude-only` |
| Routing accuracy | 91/100 | 90/100 |
| Successful decisions | 100/100 | 100/100 |
| Technical failures | 0 | 0 |
| Mean provider latency | ~291.3ms | ~1,643.2ms |
| p50 / p95 latency | 273ms / 455ms | 1,473ms / 2,418ms |
| Input / output tokens | 57,517 / 6,272 | 102,106 / 3,704 |
| Estimated cost (`pricing-v1-2026-09-22`) | $0.00241571 | $0.241252 |
| Provider-reported cost | $0 (not "free" — see note) | n/a (API returns none) |
| Action accuracy (79 annotated cases) | 68/79 (86.1%) | — |
| Policy accuracy (79 annotated cases) | 73/79 (92.4%) | — |

A one-point routing-accuracy gap on 100 synthetic cases is not treated as
meaningful superiority. Cost and latency differences are large and
structural, but are point-in-time observations under one dataset and one
pricing configuration, not a claimed universal ratio between the two
providers. A `$0` provider-reported cost is reported as exactly that
figure, never interpreted as "free."

## Provider Relationship

Out of 100 cases: **87 both correct, 4 Jev-correct/Claude-wrong, 3
Jev-wrong/Claude-correct, 6 both wrong.**

Separately (a different split, not to be conflated with the above): the
two providers chose the **same** observed route on 91 cases and
**different** routes on 9. Of the 6 "both wrong" cases, 4 are cases where
both agreed on the identical wrong route (not a disagreement), and 2 are
cases where both were wrong on different routes from each other. Two
models agreeing does not prove correctness; two models disagreeing does
not by itself indicate which one is right (of the 9 route-disagreement
cases, Jev was wrong in 4 and Claude in 3 — roughly even, no directional
pattern).

## Offline Hybrid Simulation

**`analysisMode: OFFLINE_THRESHOLD_SIMULATION`** — reconstructed entirely
from the two already-recorded complete baselines above, matched by case
ID. **Zero additional provider calls were made to produce this table.**
No Hybrid latency (mean/p50/p95/total) is reported anywhere — independently
measured baseline latencies cannot honestly stand in for real sequential
Jev→Claude execution timing; that would require an actual live Hybrid
run, which this is not.

| Threshold | Final accuracy | Jev kept | Claude calls | Fallback rate | Corrections | Regressions | Simulated cost |
|---|---|---|---|---|---|---|---|
| 0.60 | 92.0% | 89 | 11 | 11.0% | 3 | 2 | $0.028798 |
| 0.70 | 92.0% | 84 | 16 | 16.0% | 3 | 2 | $0.040786 |
| 0.80 | 92.0% | 82 | 18 | 18.0% | 3 | 2 | $0.045580 |
| 0.90 | 92.0% | 73 | 27 | 27.0% | 3 | 2 | $0.067252 |
| 0.95 | 91.0% | 64 | 36 | 36.0% | 3 | 3 | $0.089308 |

0.60 through 0.90 are functionally tied on final accuracy while spending
very different amounts on Claude; 0.95 spends the most and scores lowest,
via one additional regression. **No threshold above is called best,
optimal, or recommended** — this is a tradeoff table for a system-design
decision, not a resolved answer.

## Failure Taxonomy

- **Type A (low-confidence, correctable):** RC-060, RC-067, RC-076 — Jev
  wrong, low confidence, Claude's independent answer correct. Corrected
  at every tested threshold.
- **Type B (correct decision regresses on fallback):** RC-066, RC-086 (all
  thresholds), RC-056 (0.95 only) — Jev correct, escalates anyway, Claude
  wrong.
- **Type C (shared error):** RC-035, RC-046, RC-048, RC-049, RC-065,
  RC-070 — Jev wrong, Claude also wrong, independently. Escalation cannot
  repair these by construction.

## High-Confidence Shared Errors

| Case | Expected | Jev route | Jev confidence | Claude route |
|---|---|---|---|---|
| RC-048 | JIRA | GITHUB | 0.99 | GITHUB |
| RC-049 | JIRA | GITHUB | 0.94 | GITHUB |

RC-048 never escalates at any tested threshold (0.99 exceeds even 0.95).
RC-049 escalates only at 0.95, and even then is not corrected — Claude's
own independently-recorded decision agrees with Jev's wrong answer.
**Fallback is not verification**; this is the central architectural
finding of this benchmark. Full detail:
[`phase9-architectural-analysis.md`](phase9-architectural-analysis.md) §6.

## Confidence Caveat

Jev's confidence is used as an uncertainty signal only, never claimed
calibrated (no calibration study performed). Accuracy is not monotonic
across confidence buckets, and several buckets are small (n=2–9). See
[`phase8d-threshold-analysis.md`](phase8d-threshold-analysis.md) §F for
the full bucket table.

## Rate-Limit / Throughput Lesson

Fast per-call latency did not imply safe request throughput. The unpaced
Jev run produced 70/100 HTTP 429 responses despite fast individual
response times; fixed request pacing (2000ms, decided before the run, not
adapted during it) then produced 100/100 decisions with zero 429s. This
is reported as an operational/infrastructure finding, kept fully separate
from model routing quality. The exact provider rate limit remains
unknown, and 2000ms is not claimed universally safe. Full investigation:
[`phase8c-rate-limit-investigation.md`](phase8c-rate-limit-investigation.md).

## Decision vs. Authorization vs. Execution

Unaffected by anything measured in this benchmark, by design: no
provider's confidence, reasoning, or identity has a path around
`evaluatePolicy(action: Action)`, whose signature has no parameter through
which any of that could pass even by accident. See
[ADR-003](../../docs/adr/ADR-003-decision-authorization-execution.md).

## Architectural Takeaways

See the README's [What This Experiment Taught Us](../../README.md#what-this-experiment-taught-us)
section and the full [Phase 9 architectural analysis](phase9-architectural-analysis.md)
for the complete, evidence-linked conclusions and the explicit
supported/unsupported claims list.

## Limitations

100-case synthetic dataset; small per-category and per-confidence-bucket
sample sizes; point-in-time provider versions and pricing; unestablished
confidence calibration; an offline Hybrid reconstruction that assumes
deterministic provider repeatability; no production traffic; mock tools
only. Full list: [`src/benchmark/limitations.ts`](../../src/benchmark/limitations.ts).

## Reproducibility

```bash
npm install
npm test            # all provider calls mocked
npm run typecheck
npm run lint
npm run build

# Dry run — zero provider calls, zero cost, zero files written
npm run benchmark -- --strategy jev --dry-run
npm run benchmark -- --strategy claude --limit 5 --dry-run
npm run benchmark -- --strategy hybrid --threshold 0.8 --dry-run

# A real run requires your own AI_GATEWAY_API_KEY / ANTHROPIC_API_KEY
# and makes live, billed calls:
npm run benchmark -- --strategy jev --pacing-ms 2000
npm run benchmark -- --strategy claude

# Offline threshold reconstruction over two already-completed runs
# (zero provider calls):
npm run benchmark -- --strategy threshold-simulation \
  --jev-run benchmark/results/<jev-run-id> \
  --claude-run benchmark/results/<claude-run-id>
```

## Detailed Source Reports

- [`phase8b-baseline-results.md`](phase8b-baseline-results.md) — original Jev/Claude baseline run (Jev run rate-limited)
- [`phase8c-rate-limit-investigation.md`](phase8c-rate-limit-investigation.md) — rate-limit investigation, pacing design and implementation
- [`phase8d-threshold-analysis.md`](phase8d-threshold-analysis.md) — full offline Hybrid threshold reconstruction, complete baselines
- [`phase9-architectural-analysis.md`](phase9-architectural-analysis.md) — full architectural interpretation and claim-safety review
- [`experiment-evidence.md`](experiment-evidence.md) — evidence register: verified observations, qualified findings, unsupported conclusions
