# Phase 8B — Real Baseline Benchmark Results (JEV_ONLY + CLAUDE_ONLY + offline threshold reconstruction)

No ranking, no "best" threshold, no promotional conclusions. Raw
measurement report only, per your explicit instruction. No benchmark
configuration was changed during or after this run.

---

## A. Experiment provenance

1. Git commit: `78d36fc11daf767ffc168e40fd284770eacd38d9` (unchanged
   throughout the run)
2. Dataset version: `1.0`
3. Dataset hash: `d3617240469f7b560e0d78adf9bee7afb500d8ccc650d9eac39bc76f7b952856`
4. Routing spec: `routing-spec-v1`
5. Pricing config: `pricing-v1-2026-09-22`

---

## B. Jev baseline

6. Run ID: `20260922-165700-jev-only`
7. Completed case count: 100 (100 rows written, 100 unique case IDs)
8. Provider failure count: **70** (all `ProviderRateLimitError` — HTTP 429)
9. Route accuracy (overall, failures counted not-correct): **30/100 = 30.0%**
10. Accuracy by difficulty:
    - CLEAR: 30/53 = 56.6%
    - MODERATE: 0/38 = 0.0%
    - AMBIGUOUS: 0/9 = 0.0%
11. Accuracy by route:
    - DIRECT_ANSWER: 8/10 = 80.0%
    - DOCS: 8/18 = 44.4%
    - GITHUB: 8/26 = 30.8%
    - JIRA: 6/30 = 20.0%
    - REJECT: 0/16 = 0.0%
12. Latency (successful calls only, n=30): mean **283.7 ms**, p50 **240 ms**,
    p95 **529 ms**. Failed-attempt latency: 0 samples recorded (Jev's
    rate-limit rejections did not populate a latency figure in this
    adapter's error path).
13. Total tokens (successful calls only): **17,203 input / 1,884 output**
14. Estimated cost (pricing-v1-2026-09-22, successful calls only):
    **$0.00072253**
15. Provider-reported cost: **$0** across all 30 reporting samples — this is
    the Vercel AI Gateway's own reported figure at call time, not inferred
    or assumed; per CLAUDE.md's guardrail this is **not** interpreted as
    "Jev is free" (it may reflect an active promotional rate, and is kept
    strictly separate from the $0.00072253 estimated figure above).
16. High-confidence incorrect counts: **0 at ≥0.80, 0 at ≥0.90, 0 at ≥0.95**
    — there were zero incorrect routes at all among the 30 successful
    decisions (see confusion matrix below); observed confidence values on
    successful calls ranged from 0.5 to 1.0.
17. Confusion matrix summary (rows=expected, only nonzero cells shown):
    perfect diagonal on every successful call —
    DIRECT_ANSWER→DIRECT_ANSWER: 8, DOCS→DOCS: 8, GITHUB→GITHUB: 8,
    JIRA→JIRA: 6, REJECT→REJECT: 0 (all 16 REJECT cases failed rather than
    being misrouted). Failure column: DIRECT_ANSWER 2, DOCS 10, GITHUB 18,
    JIRA 24, REJECT 16 (sums to 70, matching the failure count exactly).

---

## C. Claude baseline

18. Run ID: `20260922-165824-claude-only`
19. Completed case count: 100 (100 rows written, 100 unique case IDs)
20. Provider failure count: **0**
21. Route accuracy (overall): **90/100 = 90.0%**
22. Accuracy by difficulty:
    - CLEAR: 51/53 = 96.2%
    - MODERATE: 34/38 = 89.5%
    - AMBIGUOUS: 5/9 = 55.6%
23. Accuracy by route:
    - DIRECT_ANSWER: 10/10 = 100.0%
    - DOCS: 15/18 = 83.3%
    - GITHUB: 25/26 = 96.2%
    - JIRA: 25/30 = 83.3%
    - REJECT: 15/16 = 93.75%
24. Latency (n=100): mean **1,643.2 ms**, p50 **1,473 ms**, p95 **2,418 ms**.
    Failed-attempt latency: 0 samples (no failures).
25. Total tokens: **102,106 input / 3,704 output** (mean ≈1,021 in / 37 out
    per case)
26. Estimated cost (pricing-v1-2026-09-22): **$0.241252**
27. Provider-reported cost: **not available** (the Messages API returns no
    dollar-cost field — `providerReportedCostUsd` is structurally absent,
    never fabricated as $0)
28. Confusion matrix summary (rows=expected, columns=observed, nonzero
    cells): DIRECT_ANSWER→DIRECT_ANSWER 10; DOCS→DOCS 15, DOCS→GITHUB 2,
    DOCS→JIRA 1; GITHUB→GITHUB 25, GITHUB→JIRA 1; JIRA→DIRECT_ANSWER 1,
    JIRA→GITHUB 4, JIRA→JIRA 25; REJECT→GITHUB 1, REJECT→REJECT 15.
    Failure column: all zero.

---

## D. Offline Hybrid threshold reconstruction

`sourceJevRunId: 20260922-165700-jev-only`,
`sourceClaudeRunId: 20260922-165824-claude-only`,
`analysisMode: OFFLINE_THRESHOLD_SIMULATION` on every row and aggregate.
**Zero provider calls made** (structurally impossible for this module — no
network activity occurred, confirmed by instant execution with no
provider-failure logs).

Because 70/100 Jev cases are `NOT_RECONSTRUCTABLE_TECHNICAL_FAILURE`
(technical rate-limit failures, never reconstructed as a guaranteed
Hybrid outcome), **every threshold's reconstructable denominator is the
same 30 cases** — the ones where Jev actually produced a decision:

| Threshold | Reconstructable | Non-reconstructable | Sim. final accuracy | Sim. fallback count/rate | Sim. Claude calls | Correct Jev escalated | Incorrect Jev escalated | Incorrect Jev not escalated | Claude corrections | Claude regressions | Sim. estimated cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.60 | 30 | 70 | 100.0% | 1 / 3.3% | 1 | 1 | 0 | 0 | 0 | 0 | $0.003107 |
| 0.70 | 30 | 70 | 100.0% | 1 / 3.3% | 1 | 1 | 0 | 0 | 0 | 0 | $0.003107 |
| 0.80 | 30 | 70 | 100.0% | 1 / 3.3% | 1 | 1 | 0 | 0 | 0 | 0 | $0.003107 |
| 0.90 | 30 | 70 | 100.0% | 1 / 3.3% | 1 | 1 | 0 | 0 | 0 | 0 | $0.003107 |
| 0.95 | 30 | 70 | 100.0% | 4 / 13.3% | 4 | 4 | 0 | 0 | 0 | 0 | $0.010251 |

All five thresholds show 100% simulated final accuracy because all 30
Jev-successful cases were themselves correctly routed (§B.17), and every
case escalated to Claude at any threshold was also correctly routed by
Claude — so there are zero incorrect-Jev-escalated, zero
incorrect-Jev-not-escalated, and zero Claude corrections/regressions to
observe in this data. This is a direct, mechanical consequence of the
70% Jev failure rate shrinking the reconstructable sample to 30 cases, not
a claim about Jev's or Hybrid's general accuracy — see "deviations" below.

No total/mean/p50/p95 Hybrid latency was computed or reported anywhere in
this analysis, per the approved design.

---

## E. Layered scoring

40. Action-layer results (independent of route accuracy):
    - Jev: 22/79 annotated correct = **27.8%**
    - Claude: 67/79 annotated correct = **84.8%**
41. Policy-layer results (independent of both route and action accuracy):
    - Jev: 22/79 annotated correct = **27.8%**
    - Claude: 73/79 annotated correct = **92.4%**

Route, action, and policy accuracy are reported here as three fully
independent figures, never blended into one score, per CLAUDE.md.

---

## F. Artifact integrity

42. Jev artifact directory: `benchmark/results/20260922-165700-jev-only/`
    (`manifest.json`, `cases.jsonl`, `summary.json`, `summary.md`,
    `confusion-matrix.json`)
43. Claude artifact directory: `benchmark/results/20260922-165824-claude-only/`
    (same file set)
44. Threshold-analysis artifact: `benchmark/results/20260922-170132-hybrid/`
    (`threshold-analysis.json`, `threshold-analysis.md`)
45. Raw prompts confirmed absent from every persisted case row in both
    `cases.jsonl` files — only `promptHash` (64-char sha256 hex) is
    present; verified programmatically (no case-result row's serialized
    JSON matched the expected prompt-content check).
46. No secrets in any artifact — verified via pattern scan
    (`sk-ant`, `AIzaSy`, generic `api_key=...`, `Bearer ...`) across all
    `.json`/`.md`/`.jsonl` files in all three run directories: zero matches.

---

## G. Execution integrity

47. Exact total live call count: **200** (100 Jev attempts + 100 Claude
    attempts — every attempt, successful or failed, is one live HTTP call;
    the 70 Jev failures were still 70 real network requests that received
    an HTTP 429 response, not skipped calls)
48. Confirmed: **zero manual retries** — each of the 100 Jev cases and 100
    Claude cases was attempted exactly once by the sequential runner; no
    case was re-run, no row was replaced
49. Confirmed: **zero live Hybrid calls** — `decideHybrid()` was never
    invoked in Phase 8B; the `20260922-170132-hybrid` directory name comes
    from `buildRunId("HYBRID", undefined)`, reused here only because the
    offline threshold-simulation output is conceptually Hybrid-shaped —
    it made no provider calls
50. Confirmed: threshold simulation made **zero provider calls** (no
    network activity, no failure logs, near-instantaneous execution,
    module has no provider-related imports — structurally verified in
    Phase 7's test suite)
51. Provider/setup failures: 70 experimental `ProviderRateLimitError`
    failures during the Jev run (see below); zero setup/config failures —
    credentials were valid (proven by receiving 429 responses rather than
    401/403), the endpoint was correct, and the runner completed all 100
    scheduled attempts without crashing or requiring intervention
52. Deviations: see below

---

## Deviations / surprising results (recorded, not fixed, per your instruction)

1. **Jev rate-limited on 70/100 requests.** All 70 failures are the single
   category `ProviderRateLimitError` (HTTP 429). No retry, backoff, delay,
   or concurrency change was applied or considered — the runner's existing
   sequential, no-retry behavior ran exactly as configured. This is
   preserved as real experimental evidence.
2. **The failure pattern is not randomly distributed — it is a contiguous
   suffix.** Every category early in dataset order (`general-engineering-knowledge`,
   `docs-lookup`, `github-code-lookup`) succeeded 100% of the time (8/8
   each), `jira-ticket-lookup` partially succeeded (6/8), and every
   category after that failed 100% of the time. This is consistent with a
   request-volume or short-window rate cap being exhausted partway through
   the ~14-second run and not recovering before the run ended — recorded
   as an observation, not diagnosed or worked around.
3. **Consequently, Jev's measured 30% overall route accuracy and 100%
   accuracy-among-successes are not comparable to a fair, complete 100-case
   sample** — the 30 successful cases are whichever ones happened to run
   before the rate limit was hit, not a random or representative subset
   (they skew toward `CLEAR`-difficulty, non-cross-system categories, per
   §B.10/§B.11). This limitation is recorded here and is not corrected for
   in any figure above.
4. **The offline threshold reconstruction's "100% accuracy at every
   threshold" is a direct, mechanical consequence of #3**, not a finding
   about Hybrid or Jev's general reliability — with only 30/100
   reconstructable cases (all of which were correct), there is no incorrect
   decision anywhere in the reconstructable set for any threshold to act
   on. No conclusion is drawn from this beyond stating the mechanical fact.
5. Jev's `providerReportedCostUsd` was `$0` for all 30 successful calls —
   recorded factually, not interpreted as "free" (§B.15).

No dataset, ground truth, routing spec, provider configuration, pricing
config, or scoring methodology was changed before, during, or after this
run.

---

**STOP — analysis review requested. No provider ranking, no "best"
threshold, no promotional content, and no further live provider calls
have been made.**
