# Phase 9 — Architectural Analysis

Analysis and documentation only. No provider call was made to produce this
report. No dataset, routing spec, threshold, provider code, or Hybrid
strategy was modified. No threshold is selected here and no provider is
ranked.

## Provenance (frozen evidence, verified before writing this report)

- Jev baseline: `20260922-174506-jev-only` — 100/100 decisions, 0 provider failures
- Claude baseline: `20260922-165824-claude-only` — 100/100 decisions, 0 provider failures
- Offline Hybrid analysis: `20260922-175924-hybrid` — 100/100 reconstructable cases at every one of the five tested thresholds (0.60/0.70/0.80/0.90/0.95)
- Dataset: `benchmark/datasets/routing-v1.0.json`, version `1.0`, SHA-256 `d3617240469f7b560e0d78adf9bee7afb500d8ccc650d9eac39bc76f7b952856` — identical across both baseline manifests
- Routing spec: `routing-spec-v1` — identical across both baseline manifests

All three source artifacts were re-inspected immediately before writing
this report and are unchanged from Phase 8B/8C-D/8D.

---

## 1. Research Questions

This project's core question is **not** "is Jev better than Claude?" The
experiment exists to inform two architectural questions:

1. Does every bounded routing decision inside an AI agent require a
   general-purpose LLM, or can a specialized decision model handle routine
   cases and escalate uncertainty?
2. Where should probabilistic AI decision-making end and deterministic
   software control begin?

Everything below is read in service of these two questions, not as a
scoreboard between two vendors.

---

## 2. Evidence Base

Two complete, independently-collected 100-case baselines under the frozen
`routing-v1.0` dataset and `routing-spec-v1`, plus one offline
reconstruction of a confidence-gated Hybrid strategy computed from those
two baselines with zero additional provider calls.

The methodology precisely: no individual case was ever selectively
retried based on its answer, no failed case was patched into an
already-completed baseline, no case was dropped from a scored run, and no
ground-truth label was changed after seeing any provider's result. What
*did* happen, and is reported openly rather than hidden: the first
`JEV_ONLY` attempt (`20260922-165700-jev-only`) hit 70/100 HTTP
rate-limit failures for reasons investigated and documented in
`phase8c-rate-limit-investigation.md`; that run was preserved unmodified
as its own artifact, not edited or discarded. After that investigation, a
separate, complete, new 100-case Jev baseline
(`20260922-174506-jev-only`) was run from RC-001 through RC-100 under a
pacing configuration (2000ms) decided and fixed *before* that run's first
request — the pacing was not tuned mid-run or chosen after seeing partial
results. A 10-case pacing check (`20260922-173856-jev-only`) preceded it
and is explicitly documented as a non-benchmark infrastructure validation,
never scored as routing evidence. All three Jev artifacts, and the
original Claude baseline, remain distinct and unmerged. Full mechanical
detail (per-case tables, confusion matrices, cost/
latency breakdowns) already exists in `phase8b-baseline-results.md` and
`phase8d-threshold-analysis.md`; this report interprets that evidence, it
does not re-derive it independently.

---

## 3. Baseline Results

**Jev** (`20260922-174506-jev-only`, paced at 2000ms): 91/100 routing
accuracy, 100/100 decisions, 0 failures. Latency mean 291.3ms / p50 273ms
/ p95 455ms. Estimated cost $0.00241571 (provider-reported $0 across all
100 samples — not interpreted as free). Two high-confidence errors at
≥0.90 (RC-048 at 0.99, RC-049 at 0.94).

**Claude** (`20260922-165824-claude-only`): 90/100 routing accuracy,
100/100 decisions, 0 failures. Latency mean 1,643.2ms / p50 1,473ms / p95
2,418ms. Estimated cost $0.241252 (no provider-reported cost field exists
for this API).

**Provider relationship** (all 100 cases): both correct 87, Jev
correct/Claude wrong 4, Jev wrong/Claude correct 3, both wrong 6.

A one-point accuracy gap (91 vs. 90) on a 100-case synthetic dataset is
**not treated as meaningful superiority** — it is within the range where a
single case going the other way would flip which number is larger. Latency
and cost, by contrast, are large and structural (Claude ~5.6x Jev's mean
latency, ~100x Jev's estimated cost on this dataset) — differences of that
magnitude are reported as observed facts, not as a verdict on which model
is "better," since the two serve different roles in the architecture this
project is testing (a fast specialized default vs. an expensive general
fallback).

---

## 4. What Hybrid Changed

From `phase8d-threshold-analysis.md`'s Table C:

| Threshold | Final Accuracy | Claude Calls | Fallback Rate | Corrections | Regressions | Simulated Cost |
|---|---|---|---|---|---|---|
| 0.60 | 92.0% | 11 | 11.0% | 3 | 2 | $0.028798 |
| 0.70 | 92.0% | 16 | 16.0% | 3 | 2 | $0.040786 |
| 0.80 | 92.0% | 18 | 18.0% | 3 | 2 | $0.045580 |
| 0.90 | 92.0% | 27 | 27.0% | 3 | 2 | $0.067252 |
| 0.95 | 91.0% | 36 | 36.0% | 3 | 3 | $0.089308 |

**Mechanically:** raising the threshold from 0.60 to 0.90 more than
doubles the fallback rate (11%→27%, tripling Claude calls and cost) while
final accuracy stays exactly flat at 92.0% — every additional escalation
in that range lands on a case Jev was already correct about
(`correctJevEscalatedCount` climbs from 6 to 20). At 0.95, one additional
case (RC-056, confidence 0.90) crosses into escalation and regresses,
dropping final accuracy to 91.0% while pushing simulated cost to its
highest tested value. **No threshold in this range is called optimal
here** — 0.60 through 0.90 are functionally tied on this dataset's final
accuracy while spending very different amounts on Claude calls, which is
itself the finding worth carrying forward, not a reason to pick one.

---

## 5. Failure Taxonomy

Three distinct failure/interaction types are visible in this data, built
directly from `phase8d-threshold-analysis.md`'s case-level tables:

**A. Low-confidence, correctable error** — Jev wrong, confidence low
enough to escalate at every tested threshold, Claude's saved decision
correct. Observed cases: **RC-060** (conf 0.47), **RC-067** (conf 0.47),
**RC-076** (conf 0.52) — all three JIRA-expected, all corrected by Claude
at every threshold from 0.60 up.

**B. Correct Jev decision that regresses on fallback** — Jev correct,
confidence low enough to escalate, Claude's saved decision wrong.
Observed: **RC-066** (conf 0.31, escalates at all five thresholds) and
**RC-086** (conf 0.53, escalates at all five), plus **RC-056** (conf 0.90,
escalates only at 0.95). A fourth case, RC-072 (conf 0.98, Jev
correct/Claude wrong), belongs to this category structurally but never
actually regresses in this data because its confidence exceeds every
tested threshold.

**C. Shared error** — Jev wrong, Claude also wrong on the same case,
independently. Escalating changes nothing because the destination the
fallback would arrive at is also incorrect. Observed: **RC-035, RC-046,
RC-048, RC-049, RC-065, RC-070** — all 6 of the cases where both providers'
routes were incorrect. Of these 6, 4 (RC-035, RC-046, RC-048, RC-049) are
cases where both providers landed on the exact same wrong route, and 2
(RC-065, RC-070) are cases where both were wrong but chose *different*
wrong routes — "both wrong" and "chose different routes" are kept as
separate facts throughout this report (see §10). Only RC-048 (confidence
0.99) and RC-049 (confidence 0.94) are high-confidence (≥0.90) among these
6 — the other four (RC-035 at 0.31, RC-046 at 0.68, RC-065 at 0.62, RC-070
at 0.29) are low- or moderate-confidence shared errors, not high-confidence
ones.

Type C is the category this phase focuses on, because it is the one type
of failure that confidence-threshold escalation, by construction, cannot
address.

---

## 6. High-Confidence Shared Errors

**RC-048** — expected JIRA, Jev observed GITHUB at confidence 0.99, Claude
observed GITHUB. **RC-049** — expected JIRA, Jev observed GITHUB at
confidence 0.94, Claude observed GITHUB.

RC-048 never escalates at any of the five tested thresholds — its
confidence (0.99) exceeds the highest one tested (0.95). RC-049 escalates
only at the 0.95 threshold; when it does, the fallback still cannot fix
it, because Claude's own independently-recorded baseline decision on this
exact case agrees with Jev's wrong answer. **Escalation is therefore
insufficient for this specific failure type, on this specific evidence** —
not because the threshold was set wrong, but because the mechanism only
ever substitutes one provider's answer for another's, and here both
providers' answers are the same wrong one.

This is not evidence that "all models would make this mistake" or that
the underlying semantic difficulty generalizes beyond these two specific
cases in this specific dataset — it is a fact about these two rows,
reported because it is the most architecturally informative failure this
experiment produced: **the most interesting failure here was not "Jev was
unsure," it was "Jev was confident, wrong, and Claude independently
reached the same wrong conclusion."**

---

## 7. Confidence as an Uncertainty Signal

From `phase8d-threshold-analysis.md`'s confidence buckets:

| Bucket | n | Accuracy |
|---|---|---|
| 0.20–0.49 | 8 | 50.0% |
| 0.50–0.59 | 3 | 66.7% |
| 0.60–0.69 | 5 | 60.0% |
| 0.70–0.79 | 2 | 100.0% |
| 0.80–0.89 | 9 | 100.0% |
| 0.90–0.94 | 9 | 88.9% |
| 0.95–1.00 | 64 | 98.4% |

Confidence here is used strictly as an **uncertainty signal**, not
established as a calibrated probability of correctness — no calibration
study (comparing predicted probability to empirical frequency across
repeated trials) has been performed, consistent with CLAUDE.md's
guardrail. Accuracy is **not monotonic** across every bucket boundary: the
0.90–0.94 bucket (88.9%) is less accurate than the 0.80–0.89 bucket
(100.0%), and the large 0.95–1.00 bucket, while high at 98.4%, is not
perfect and contains RC-048.

**Architectural implication, stated cautiously:** a confidence threshold
can identify *some* cases where the model itself is uncertain, and this
experiment shows it correctly does so for the three Type-A correctable
errors. It **cannot guarantee detection of a confident semantic error** —
a case where the model has, in effect, misunderstood the request but
reports high certainty in that misunderstanding. Confidence measures how
sure the model is, not whether the model is right.

---

## 8. Cross-System Ambiguity

Inspecting the 6 shared-error (both-wrong) cases for descriptive pattern,
separating what is observed from what is interpreted:

**OBSERVED:** 4 of the 6 shared-error cases (RC-046, RC-048, RC-049,
RC-065) fall in categories named `cross-system-ticket-context` or
`ambiguous-cross-system` — categories whose case descriptions (per
`phase3-review.md`'s labeling notes) involve a request that references
more than one system (e.g., a ticket that discusses a PR, or a code
question framed around a ticket number).

**INTERPRETATION (explicitly flagged as such, not a label change):** a
plausible reading of why these are hard for both providers is a
distinction between *"which system does the request mention"* versus
*"which system contains the actual artifact the user wants returned."* In
the two clearest examples (RC-048, RC-049), the expected destination is
JIRA — the request is fundamentally about a Jira ticket, which is what
should actually be read or searched — but the ticket's own description
apparently references a GitHub artifact (a PR, commit, or repo). Both
providers routed to GITHUB instead of JIRA in both cases. A plausible
reading is that the *mentioned* system (GITHUB, named concretely inside
the ticket's content) pulled both models away from the *intended
destination* system (JIRA, the thing actually being asked about) — the
mention outweighing the underlying intent. This is offered as a
hypothesis about why these specific cases are hard, not as a claim that
the dataset's labels are wrong or that this pattern would replicate on
different phrasing — no label was changed to test or confirm this
hypothesis, and none should be.

Two other observed shared-error cases (RC-035, a JIRA-creation case
misrouted to GITHUB, and RC-070, a DOCS-expected case) do not fit this
cross-system-mention pattern as cleanly and are reported here without a
proposed explanation, to avoid over-fitting a narrative to convenient
cases.

---

## 9. `cross-system-ticket-context` Category Analysis

n = 5. Jev baseline: 2/5 correct (40%). All 3 incorrect cases are also
Claude-wrong. No tested confidence threshold repairs any of the three,
because the fallback destination (Claude's decision) is identical to the
mistake being escalated away from.

This is notable **inside this dataset** and is explicitly **not** treated
as evidence of a general provider weakness — n=5 is too small to support
a claim beyond "in these five specific cases, both providers struggled the
same way." The candidate explanation from §8 (mentioned-system vs.
intended-destination-system) applies most directly here, since every one
of this category's case descriptions plausibly involves a cross-system
reference.

---

## 10. Provider Disagreement

**"Both providers were wrong" and "the two providers chose different
routes" are kept as two separate facts in this section** — a case can be
wrong for both without being a route disagreement (both landing on the
same incorrect route), and this distinction was recomputed directly from
the persisted per-case results rather than taken from earlier prose, per
methodology-integrity review.

Recomputed directly from `20260922-174506-jev-only` and
`20260922-165824-claude-only`'s per-case `route` field, all 100 cases:
**91 cases where Jev and Claude chose the same route, 9 where they chose
different routes.** The 9 route-disagreement cases split three ways:

- **Jev correct / Claude wrong (4):** RC-056, RC-066, RC-072, RC-086
- **Jev wrong / Claude correct (3):** RC-060, RC-067, RC-076
- **Both wrong, but on different routes from each other (2):** RC-065, RC-070

That accounts for all 9 (4+3+2). Separately, and **not** part of this
9-case route-disagreement set: 4 more cases (RC-035, RC-046, RC-048,
RC-049) are cases where both providers were wrong *and agreed with each
other* on the same incorrect route — these are shared errors (§5, Type C)
but not disagreements in the route-choice sense, since there was no
disagreement to observe. Combining the two: of the 6 total "both wrong"
cases across the dataset, 4 agree with each other on the wrong route and
2 disagree with each other while both being wrong.

**What this shows:** among the 9 cases where the providers actually chose
different routes, one of them is right and the other wrong in 7 of the 9
(4 favoring Jev, 3 favoring Claude — roughly even), and both are wrong in
the remaining 2. Disagreement therefore correlates with a real chance that
one provider is right, but is not itself evidence of *which* one is more
likely correct in a given instance. **No ensemble or voting rule is
proposed from this** — with only 9 cases and no consistent directional
pattern (4 vs. 3 is not a meaningful split), inventing a "when they
disagree, prefer X" heuristic here would be fitting noise, not a finding.

---

## 11. Decision vs. Authorization vs. Execution

This project's second architectural boundary — `DECISION != AUTHORIZATION
!= EXECUTION` — is unaffected by anything measured in this experiment, by
design. The pipeline, unchanged throughout Phases 3–8:

```
Request
  → AI routing decision (Jev, optionally Claude on fallback)
  → optional AI fallback (Hybrid escalation)
  → final AI decision
  → AI DECISION ENDS HERE
  → deterministic policy (evaluatePolicy — takes only an Action, never a
    confidence score or model identity)
  → ALLOW / REQUIRE_REVIEW / DENY
  → tool execution (only after ALLOW)
```

Nothing in this experiment gives either provider's confidence, reasoning,
or identity a path around `evaluatePolicy`. A `DELETE_DATABASE` action is
DENY regardless of which provider proposed it or how confident that
provider was — `src/policy/policy-rules.ts` is unchanged, and
`derive-action.ts`'s destructive-intent check runs independently of and
before the route switch, exactly as established in Phase 1. **Even a
99%-confident AI recommendation does not carry authority to act** — that
authority lives only in the deterministic policy layer, which has no
visibility into confidence or model identity even in principle.

---

## 12. Model Latency vs. Operational Throughput

This experiment surfaced (Phase 8B/8C) a distinct system concern from
routing accuracy: **operational throughput is not implied by low
per-call latency.** Jev's mean provider latency (~283–314ms across the
unpaced and paced runs) is fast — but the unpaced Phase 8B run still
produced 70 HTTP 429 rate-limit failures out of 100 requests, because
Vercel AI Gateway's applicable rate limit (documented behavior, not a
published fixed number — see `phase8c-rate-limit-investigation.md`) is a
request-*rate* constraint, unrelated to how quickly any single request
resolves. Fixed 2000ms pacing — a benchmark execution change, never a
provider or model change — produced 100/100 decisions with zero 429s in
both the 10-case validation and the full 100-case run. **The exact Gateway
limit remains unknown**; pacing at 2000ms is reported as a value that
worked in these two specific runs, not as a proven-safe rate in general.

This experiment therefore surfaces (at least) four separate system
concerns that are easy to conflate but are architecturally distinct:

1. **Model decision quality** — routing accuracy, confusion patterns (§3)
2. **Uncertainty/escalation strategy** — the confidence-threshold Hybrid mechanism (§4–7)
3. **Operational throughput** — rate limits, pacing, request cadence (this section)
4. **Deterministic authorization/execution control** — policy, unaffected by any of the above (§11)

A system can score well on one of these and fail on another — Jev scored
well on (1) and (3) only after pacing was added; nothing about its
decision quality changed between the unpaced and paced runs.

---

## 13. What This Hybrid Strategy Can and Cannot Do

**Can, on this evidence:**
- Escalate some low-confidence mistakes (3 corrections, Type A, §5)
- Reduce some Jev errors when Claude's independent answer differs and is right
- Introduce regressions when Claude's independent answer differs and is wrong (2–3 cases, Type B)
- Increase general-model usage and cost as the threshold rises, without a guaranteed accuracy return (§4)
- Fail to repair shared errors, by construction (Type C, §5–6)

**Not claimed:** this mechanism is not shown to be production-ready. It is
a confidence-threshold reconstruction over one 100-case synthetic dataset,
evaluated offline from two point-in-time baselines.

---

## 14. What It Cannot Do

The current mechanism, as tested, cannot by itself detect:

- A confident shared misunderstanding between the two providers (§6)
- Incorrect ground truth/taxonomy in the dataset itself — nothing in the
  Hybrid mechanism checks the answer key; both providers being "wrong"
  here is scored against a fixed, human-authored label, not independently
  re-verified
- Novel, out-of-distribution request phrasing not resembling this dataset
- All ambiguous multi-system intent (only the low-confidence subset gets
  escalated at all; RC-048's high confidence means it never reaches the
  fallback mechanism regardless of threshold)
- Correlation between the two providers' errors — nothing in
  `decideHybrid()` or the offline simulation checks whether Claude's
  answer is *independent* evidence versus a *shared* blind spot before
  trusting it as a correction

No new implementation is proposed to address any of these in this phase.

---

## 15. Future Work (not implemented, not scheduled)

- Category-aware escalation (e.g., always escalate `cross-system-*` categories regardless of confidence)
- Explicit cross-system intent detection as a separate signal from route confidence
- Using provider *disagreement* itself as an additional escalation signal
- An independent verifier/judge model, distinct from "ask a second router"
- Top-2 route handling (acting on route ambiguity directly rather than only on confidence)
- Multi-stage routing (e.g., a coarse system-family decision before a fine-grained action decision)
- Tool-pruning or scoping after route selection
- Genuine live Hybrid latency measurement (never estimated from independent baselines, per §12 of `phase8d-threshold-analysis.md`)
- A larger, more diverse benchmark dataset beyond 100 hand-authored cases
- Repeated runs of the same 100 cases to measure decision stability/variance
- A real calibration study (predicted-probability vs. empirical-frequency) before any calibration claim is made

None of these are claimed to necessarily improve results if implemented —
they are open questions this experiment raises, not conclusions it reached.

---

## 16. The Threshold Tradeoff (no selection made)

0.60 through 0.90 produce **identical final accuracy (92.0%)** on this
dataset while spending very different amounts on Claude — 11 calls at
0.60 versus 27 at 0.90, a 2.5x difference in fallback volume and roughly
2.3x difference in simulated cost, for the same measured outcome. 0.95
produces **more fallbacks, higher simulated cost, one additional
regression, and lower final accuracy (91.0%)** than every lower threshold
tested. The data does not force a single choice among 0.60–0.90 — it is
left here as a system-design tradeoff (how much Claude usage/cost is
acceptable for no accuracy change on this dataset), not resolved by this
report.

---

## 17. Architectural Conclusions

Findings from this experiment, not universal claims:

1. **Not every bounded routing decision in this benchmark required a
   general-purpose LLM** — Jev alone reached 91/100 on this dataset, faster
   and at a fraction of Claude's estimated per-call cost.
2. **Confidence-based escalation recovered some, but not all, low-confidence
   errors** — 3 of Jev's 9 total incorrect decisions on this dataset were
   corrected by the fallback at every tested threshold (this "9" is the
   total count of Jev mistakes, a different set from the 9 cases in §10
   where the two providers chose different routes — the two totals happen
   to be the same size but are not the same set of cases).
3. **Escalation is not free** — raising the threshold from 0.60 to 0.90
   more than doubled simulated Claude usage without improving final
   accuracy on this dataset, and 0.95 introduced a net accuracy decrease
   via one additional regression.
4. **Confidence alone did not protect against confident shared errors** —
   the two highest-confidence Jev mistakes (RC-048, RC-049) were not fixed
   by any tested threshold, because Claude's independent answer agreed
   with the mistake in both cases.
5. **A specialized and a general-purpose model can share the same semantic
   failure mode** — being wrong is not always a property one model has and
   the other lacks; on 6 of 100 cases here, both were wrong on the same
   question.
6. **Decision-making stayed fully separate from authorization** throughout
   every phase of this experiment — no provider's confidence or identity
   reached the deterministic policy layer at any point, and nothing
   measured here required or suggested changing that boundary.
7. **Operational throughput is a distinct concern from model latency** — a
   fast model was still unusable at full volume until request pacing (a
   benchmark-execution change, not a model change) was introduced.
8. **Benchmark integrity was load-bearing for these findings** — the
   frozen dataset, unmodified ground truth, and prohibition on relabeling
   after seeing results are what make §6 and §9's shared-error findings
   trustworthy; had labels been adjusted after observing that both
   providers disagreed with them, no shared-error conclusion could be
   drawn at all.

---

## 18. Limitations

- Single synthetic, 100-case, hand-authored dataset — see
  `src/benchmark/limitations.ts` for the full standing limitations list,
  all of which apply here unchanged.
- The Jev and Claude baselines were collected at different wall-clock
  times under potentially different network/provider conditions (affects
  latency comparisons only, not the routes/confidence used for the
  Hybrid reconstruction).
- Jev's confidence signal is not established as calibrated; §7's
  bucket table is descriptive of this dataset, not a calibration
  measurement.
- The offline Hybrid reconstruction assumes each provider's saved decision
  would repeat identically on a genuine live Hybrid call at the same
  moment — a reasonable but unverified assumption for non-deterministic
  model outputs.
- No live Hybrid latency has ever been measured at scale in this project;
  the one Phase 6 smoke test remains a wiring check only, not evidence.
- Category- and confidence-bucket-level observations in §7–9 rest on very
  small sample sizes (as few as 2–9 cases) and are stated as dataset-
  specific facts, not general claims.

---

## 19. Claims Supported / Claims NOT Supported

**SUPPORTED** (directly verifiable from the frozen artifacts):
- Jev produced 91 correct routes on this frozen 100-case dataset.
- Claude produced 90 correct routes on this frozen dataset.
- The simulated confidence fallback produced exactly the recorded
  threshold results in `20260922-175924-hybrid`.
- Two Jev errors occurred at ≥0.90 confidence (RC-048 at 0.99, RC-049 at 0.94).
- Claude independently produced the same wrong route (GITHUB) as Jev on
  both RC-048 and RC-049.
- The paced Jev run (`20260922-174506-jev-only`) completed 100 provider
  decisions with zero HTTP 429 responses in that run.

**NOT SUPPORTED** (not shown by this experiment, and not claimed anywhere
in this report):
- Jev is generally more accurate than Claude.
- Jev's confidence is calibrated.
- 0.80 (or any tested value) is the best production threshold.
- Hybrid always improves accuracy.
- Claude reliably corrects Jev's mistakes.
- Cross-system requests are generally hard for Jev (or for Claude).
- Paced execution at 2000ms guarantees no future 429s.
- These results generalize to production traffic, a different dataset, or
  different model versions.

---

**STOP — Phase 9 is analysis and documentation only. No provider call was
made. No threshold was selected. No provider was ranked. Waiting for
review.**
