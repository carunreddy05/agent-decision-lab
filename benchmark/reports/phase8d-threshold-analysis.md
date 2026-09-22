# Phase 8D — Offline Hybrid Threshold Reconstruction (complete 100/100 baselines)

Offline analysis only. Zero Jev calls, zero Claude calls, zero Hybrid calls.
No provider ranking, no best-threshold selection, no LinkedIn content.

---

## A. Provenance

1. Jev source run ID: `20260922-174506-jev-only`
2. Claude source run ID: `20260922-165824-claude-only`
3. Dataset version/hash: `1.0` / `d3617240469f7b560e0d78adf9bee7afb500d8ccc650d9eac39bc76f7b952856` (identical on both source manifests)
4. Routing spec: `routing-spec-v1` (identical on both)
5. Pricing config: `pricing-v1-2026-09-22` (identical on both)
6. Analysis mode: `OFFLINE_THRESHOLD_SIMULATION` (tagged on every aggregate and every case result)

**Source-run verification (§1 of your instructions):** both directories have exactly 100 rows, 100 unique case IDs, RC-001 through RC-100 in order, identical dataset version/hash/routing spec/pricing config, `fullDataset: true`, and 0 provider failures. Jev manifest confirms `pacingMs: 2000`. Claude manifest is the original, unmodified Phase 8B artifact (predates the `pacingMs` field entirely — not a mismatch, just an older manifest, as designed). No provenance mismatch found.

**Live-access verification (§2):** `scripts/benchmark-runner.ts`'s `threshold-simulation` code path calls only `loadDataset`, `readJsonl`, `simulateThreshold`, and `renderThresholdAnalysisMarkdown` — it never imports or constructs `JevRouterProvider`, `ClaudeRouterProvider`, or `decideHybrid()`. `simulateThreshold()` itself has no provider-related imports at all (structurally verified by a dedicated Phase 7 test that inspects its import statements). The run completed instantly with zero network activity.

---

## B. Provider relationship (all 100 cases)

7. Jev correct / Claude correct: **87**
8. Jev correct / Claude wrong: **4** — RC-056, RC-066, RC-072, RC-086
9. Jev wrong / Claude correct: **3** — RC-060, RC-067, RC-076
10. Jev wrong / Claude wrong: **6** — RC-035, RC-046, RC-048, RC-049, RC-065, RC-070

(87+4+3+6 = 100 ✓. Separately: the two providers chose a different observed route in exactly **9** of the 100 cases — the same 9 cases listed in rows 8–10 above; the 87 "both correct" cases are also all route-identical.)

---

## C. Threshold comparison table

No BEST/WINNER/RECOMMENDED/OPTIMAL label anywhere below — tradeoffs only, no threshold selected.

| Threshold | Final Accuracy | Jev Kept | Claude Calls | Fallback Rate | Incorrect Jev Escalated | Incorrect Jev Not Escalated | Claude Corrections | Claude Regressions | Correct Jev Escalated | Simulated Cost |
|---|---|---|---|---|---|---|---|---|---|---|
| 0.60 | 92.0% | 89 | 11 | 11.0% | 5 | 4 | 3 | 2 | 6 | $0.028798 |
| 0.70 | 92.0% | 84 | 16 | 16.0% | 7 | 2 | 3 | 2 | 9 | $0.040786 |
| 0.80 | 92.0% | 82 | 18 | 18.0% | 7 | 2 | 3 | 2 | 11 | $0.045580 |
| 0.90 | 92.0% | 73 | 27 | 27.0% | 7 | 2 | 3 | 2 | 20 | $0.067252 |
| 0.95 | 91.0% | 64 | 36 | 36.0% | 8 | 1 | 3 | 3 | 28 | $0.089308 |

Reconstructable case count: **100/100 at every threshold** (0 non-reconstructable — both baselines are complete). Final failures at every threshold: **0** (no Claude baseline failure exists to propagate, and no Jev technical failure exists to mark non-reconstructable).

`simulatedEstimatedCostUsd` = observed Jev estimated cost for all 100 cases (constant ≈$0.0024 baseline, always paid) + observed Claude estimated cost for only that threshold's fallback cases (using each case's actual persisted `estimatedCostUsd`, not an averaged figure).

**No Hybrid latency (mean/p50/p95/total) is reported anywhere in this analysis** — per your instruction, independently-collected baseline latencies cannot honestly reconstruct real sequential Jev→Claude execution timing. Separately, for reference only: Jev baseline provider latency (this run) mean 291.3ms/p50 273ms/p95 455ms; Claude baseline provider latency (Phase 8B) mean 1,643.2ms/p50 1,473ms/p95 2,418ms. Fallback frequency is in the table above. These are never combined into a Hybrid figure.

---

## D. High-confidence errors

### 21–22. RC-048 and RC-049 across all five thresholds

| Case | Threshold | Escalates? | Final provider | Final route | Claude's own saved route | Claude correct? |
|---|---|---|---|---|---|---|
| RC-048 (conf 0.99) | 0.60 | No | Jev | GITHUB | GITHUB | No |
| RC-048 | 0.70 | No | Jev | GITHUB | GITHUB | No |
| RC-048 | 0.80 | No | Jev | GITHUB | GITHUB | No |
| RC-048 | 0.90 | No | Jev | GITHUB | GITHUB | No |
| RC-048 | 0.95 | No (0.99 ≥ 0.95) | Jev | GITHUB | GITHUB | No |
| RC-049 (conf 0.94) | 0.60 | No | Jev | GITHUB | GITHUB | No |
| RC-049 | 0.70 | No | Jev | GITHUB | GITHUB | No |
| RC-049 | 0.80 | No | Jev | GITHUB | GITHUB | No |
| RC-049 | 0.90 | No | Jev | GITHUB | GITHUB | No |
| RC-049 | 0.95 | **Yes** (0.94 < 0.95) | **Claude** | GITHUB | GITHUB | No |

**Neither case is ever corrected by any tested threshold.** RC-048 (expected JIRA) never escalates at any of the five thresholds — its confidence (0.99) exceeds even the highest tested threshold. RC-049 escalates only at 0.95, but Claude's own independently-recorded baseline decision for RC-049 is **also GITHUB** (also wrong) — so even where the fallback rule does fire, it produces no correction here. This is reported as a mechanical fact from the two saved baselines, not a Hybrid-design judgment.

### 23. All incorrect Jev decisions with confidence ≥ 0.80 (full list, 2 total)

| Case | Expected | Jev route | Confidence | Difficulty | Category |
|---|---|---|---|---|---|
| RC-048 | JIRA | GITHUB | 0.99 | MODERATE | cross-system-ticket-context |
| RC-049 | JIRA | GITHUB | 0.94 | MODERATE | cross-system-ticket-context |

(No incorrect Jev decisions exist at confidence ≥0.80 beyond these two — this is the complete set, matching Table C's `incorrectJevNotEscalatedCount` counts exactly: 4 at 0.60/0.70(2)/0.80(2)/0.90(2), 1 at 0.95, since some lower-but-still-≥0.80 cases like RC-046 (0.68) don't qualify for this ≥0.80 cut but do count toward "not escalated" at lower thresholds.)

---

## Claude corrections (full detail, §8)

**3 cases, constant across all five thresholds** — each has Jev confidence below even the lowest tested threshold (0.60), so all three are already escalated at 0.60 and remain escalated at every higher threshold:

| Case | Threshold(s) | Jev route | Jev confidence | Claude route | Expected | Difficulty | Category |
|---|---|---|---|---|---|---|---|
| RC-060 | all five (0.60–0.95) | DOCS | 0.47 | JIRA | JIRA | MODERATE | adversarial-distractor |
| RC-067 | all five | DIRECT_ANSWER | 0.47 | JIRA | JIRA | AMBIGUOUS | ambiguous-cross-system |
| RC-076 | all five | DOCS | 0.52 | JIRA | JIRA | MODERATE | multi-intent |

## Claude regressions (full detail, §7)

| Case | Threshold(s) it regresses at | Jev route | Jev confidence | Claude route | Expected | Difficulty | Category |
|---|---|---|---|---|---|---|---|
| RC-066 | all five (0.60–0.95) | JIRA | 0.31 | DIRECT_ANSWER | JIRA | AMBIGUOUS | ambiguous-cross-system |
| RC-086 | all five | REJECT | 0.53 | GITHUB | REJECT | CLEAR | unsupported-capability |
| RC-056 | **0.95 only** | DOCS | 0.90 | GITHUB | DOCS | MODERATE | cross-system-code-to-docs |
| RC-072 | never (0.98 ≥ every tested threshold) | GITHUB | 0.98 | JIRA | GITHUB | AMBIGUOUS | multi-intent |

RC-072 is listed for completeness (it is a "Jev correct/Claude wrong" case) but never actually regresses at any tested threshold — its 0.98 confidence keeps it with Jev throughout.

## Incorrect Jev, not escalated — "confident and wrong" cases (§9)

For each threshold, the specific cases where Jev stayed wrong because confidence ≥ threshold, with whether Claude's own saved decision would have corrected it had escalation occurred:

| Case | Jev confidence | Expected | Jev route | Claude's saved route | Would Claude have corrected it? | Not-escalated at thresholds |
|---|---|---|---|---|---|---|
| RC-046 | 0.68 | JIRA | GITHUB | GITHUB | **No** | 0.60, 0.70, 0.80, 0.90 |
| RC-048 | 0.99 | JIRA | GITHUB | GITHUB | **No** | 0.60, 0.70, 0.80, 0.90, 0.95 |
| RC-049 | 0.94 | JIRA | GITHUB | GITHUB | **No** | 0.60, 0.70, 0.80, 0.90 |
| RC-065 | 0.62 | DOCS | DIRECT_ANSWER | GITHUB | **No** | 0.60 only |

RC-065 (confidence 0.62) is not-escalated only at threshold 0.60 (0.62 ≥ 0.60); at 0.70/0.80/0.90/0.95 it *is* escalated (0.62 is below those thresholds) and moves into `incorrectJevEscalatedCount` instead — but since Claude's own saved route for RC-065 is also wrong (GITHUB, not DOCS), it remains uncorrected there too.

**Every "confident and wrong, not escalated" case across every threshold would also not have been corrected even if escalated** — for RC-046, RC-048, and RC-049, Claude's own independent baseline decision agrees with Jev's wrong answer. This is the single most load-bearing factual finding in this dataset: the headline high-confidence-error cases are not fixable by this Hybrid mechanism at any of the five tested thresholds, because the error is shared between both providers, not unique to Jev.

## Correct Jev, escalated (§10 — reported factually, not labeled "wasted")

| Threshold | Count |
|---|---|
| 0.60 | 6 |
| 0.70 | 9 |
| 0.80 | 11 |
| 0.90 | 20 |
| 0.95 | 28 |

These are cases where Jev's saved decision was already correct but its confidence fell below the threshold, so the simulation calls Claude anyway. Reported as a count only — no characterization of whether this represents good or bad tradeoff design.

---

## E. Difficulty and category analysis

### 24–25. Final accuracy and fallback rate by difficulty, per threshold

| Threshold | CLEAR accuracy | CLEAR fallback rate | MODERATE accuracy | MODERATE fallback rate | AMBIGUOUS accuracy | AMBIGUOUS fallback rate |
|---|---|---|---|---|---|---|
| 0.60 | 96.2% (51/53) | 5.7% (3/53) | 92.1% (35/38) | 5.3% (2/38) | 66.7% (6/9) | 66.7% (6/9) |
| 0.70 | 96.2% (51/53) | 7.5% (4/53) | 92.1% (35/38) | 13.2% (5/38) | 66.7% (6/9) | 77.8% (7/9) |
| 0.80 | 96.2% (51/53) | 7.5% (4/53) | 92.1% (35/38) | 18.4% (7/38) | 66.7% (6/9) | 77.8% (7/9) |
| 0.90 | 96.2% (51/53) | 11.3% (6/53) | 92.1% (35/38) | 34.2% (13/38) | 66.7% (6/9) | 88.9% (8/9) |
| 0.95 | 96.2% (51/53) | 18.9% (10/53) | 89.5% (34/38) | 47.4% (18/38) | 66.7% (6/9) | 88.9% (8/9) |

**Observation (mechanical, not interpretive):** AMBIGUOUS accuracy stays exactly flat at 66.7% across all five thresholds even as its fallback rate climbs from 66.7% to 88.9% — because within AMBIGUOUS, one correction (RC-067, gained) and one regression (RC-066, lost) both fire at the very first threshold tested (both have confidence <0.60) and cancel out; no further threshold increase changes the AMBIGUOUS-difficulty count. CLEAR accuracy is completely flat because its one incorrect case (RC-035) is a Jev-wrong/Claude-wrong case — escalating it changes nothing. MODERATE dips slightly only at 0.95, exactly when RC-056 (confidence 0.90) crosses into escalation and regresses.

### 26. Category-level observations (named categories only; small samples flagged)

- **`cross-system-ticket-context`** (n=5): Jev baseline accuracy 2/5 = 40% — the lowest of any category. Its 3 incorrect cases (RC-046 conf 0.68, RC-048 conf 0.99, RC-049 conf 0.94) are **all** Jev-wrong/Claude-wrong — Claude independently gets every one of them wrong too. **No tested threshold can improve this category's accuracy at all** — escalating more of these cases only spends money without changing the outcome, since Claude agrees with Jev's error in every case in this category. Sample size is small (5); this observation is specific to these 5 cases, not a general category claim.
- **`ambiguous-cross-system`** (n=8, from the AMBIGUOUS-difficulty rows above plus RC-066): the one category containing both an available correction (RC-067) and a live regression (RC-066), both triggering at the lowest tested threshold.
- **`multi-intent`** (n=6): 1 incorrect Jev case (RC-076, conf 0.52), correctable by Claude at every threshold; also contains RC-072 (Jev correct, conf 0.98, Claude wrong) which never regresses because its confidence exceeds every tested threshold.
- **`adversarial-distractor`** (n=7): 1 incorrect Jev case (RC-060, conf 0.47), correctable by Claude at every threshold.

All four category notes above are drawn from very small per-category sample sizes (5–8 cases) — stated here as descriptive facts about this specific 100-case dataset, not generalized claims about these categories.

---

## F. Confidence quality

### 27. Confidence buckets (Jev baseline, all 100 cases)

| Bucket | n | Correct | Accuracy |
|---|---|---|---|
| 0.20–0.49 | 8 | 4 | 50.0% |
| 0.50–0.59 | 3 | 2 | 66.7% |
| 0.60–0.69 | 5 | 3 | 60.0% |
| 0.70–0.79 | 2 | 2 | 100.0% |
| 0.80–0.89 | 9 | 9 | 100.0% |
| 0.90–0.94 | 9 | 8 | 88.9% |
| 0.95–1.00 | 64 | 63 | 98.4% |

(Lowest observed confidence: 0.29. No bucket below 0.20 exists in this dataset.)

### 28. Does high confidence perfectly predict correctness?

**No.** The 0.95–1.00 bucket (64 cases, the large majority of the dataset) is 98.4% accurate — high but not perfect, and it contains exactly one of the two headline high-confidence errors (RC-048, confidence 0.99). The 0.90–0.94 bucket is lower (88.9%) than the 0.80–0.89 bucket (100.0%) — accuracy does not increase monotonically with confidence across every bucket boundary in this dataset. This is reported as an observed, non-monotonic pattern in these specific 100 cases — **not** a calibration measurement (no calibration study, such as comparing predicted probability to empirical frequency across many repeated trials, has been performed), and per CLAUDE.md's guardrail, this confidence signal is not described as calibrated.

### 29. Sparse-bucket warning

The 0.50–0.59 (n=3) and 0.70–0.79 (n=2) buckets are too small for their accuracy percentages (66.7%, 100.0%) to be treated as meaningful rates — each is one or two cases away from a very different-looking number. Stated explicitly so these two buckets are not over-read.

---

## G. Integrity

30. Threshold artifact directory: **`benchmark/results/20260922-175924-hybrid/`** (`threshold-analysis.json`, `threshold-analysis.md`)
31. 100 reconstructable cases at every threshold: **confirmed** (0 non-reconstructable at all five)
32. Zero provider calls: **confirmed** (instant execution, no network activity, no failure logs; `simulateThreshold()` has no provider-related imports)
33. Raw prompt absence: **confirmed** — every case result carries only `promptHash`, no `prompt` field, verified programmatically
34. Secret absence: **confirmed** — pattern scan across both new artifact files returned zero matches
35. Old incomplete Hybrid artifact (`20260922-170132-hybrid`, the 30-case-only simulation) **untouched** — file modification time still `Sep 22 13:01:32`, unchanged
36. Source baselines untouched — `20260922-174506-jev-only` and `20260922-165824-claude-only` manifest modification times unchanged (`13:48:53` and `13:01:09` respectively, matching their original completion times)

---

## H. Limitations

37. **General limitations of offline reconstruction:** this analysis assumes each case's Jev/Claude decision would be identical if a genuine live Hybrid run were made at the same moment — a reasonable but unverified assumption, since neither provider's behavior is guaranteed deterministic across separate calls. The two baselines were also collected at different wall-clock times (Jev: ~17:45–17:48 UTC paced run; Claude: Phase 8B, ~16:58–17:01 UTC) under potentially different network/provider load conditions, though this affects only latency (already excluded here), not the recorded routes/confidence used for reconstruction.
38. **Latency limitation:** no Hybrid mean/p50/p95/total latency is claimed anywhere in this report, per your explicit instruction — genuine sequential Jev→Claude orchestration latency (including any inter-call overhead) can only come from an actual live `decideHybrid()` run, never from summing two independently-measured baseline latencies.
39. **Confidence/calibration limitation:** Jev's confidence value is used here purely as an uncertainty *signal* for the threshold rule — nothing in this report claims it is a calibrated probability of correctness (see §F.28). "98.4% accuracy in the 0.95–1.00 bucket" is a descriptive fact about this dataset, not a calibration measurement.
40. **Unexpected observations:** (a) both headline high-confidence Jev errors (RC-048, RC-049) are cases where Claude's independent baseline decision agrees with Jev's wrong answer — Hybrid escalation cannot fix either one at any tested threshold; (b) the `cross-system-ticket-context` category (n=5) has zero fixable errors across all five thresholds for the same reason; (c) AMBIGUOUS-difficulty final accuracy is exactly flat across all five thresholds because one correction and one regression trigger simultaneously at the lowest tested threshold and never change again as more cases escalate.

---

**STOP — Phase 8D complete. No threshold has been selected or recommended. No Jev/Claude ranking has been made. No live Hybrid call has been made. No provider was rerun. Waiting for Phase 9 analysis review.**
