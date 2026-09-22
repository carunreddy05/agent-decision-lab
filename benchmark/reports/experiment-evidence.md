# Experiment Evidence Register

An engineering evidence register: what this experiment actually observed,
and what we are and are not justified in saying about it. This is not
promotional material, posting content, or personal-branding material — it
exists to draw a hard line between verified fact and story, regardless of
where or how the project is later discussed.

## Experiment Questions

1. Does every bounded routing decision inside an AI agent require a
   general-purpose LLM, or can a specialized decision model handle
   routine cases while escalating uncertain ones?
2. Where should probabilistic AI decision-making end and deterministic
   software control begin?

## Verified Observations

Facts directly supported by the frozen benchmark artifacts
(`20260922-174506-jev-only`, `20260922-165824-claude-only`,
`20260922-175924-hybrid`):

- 100 frozen, synthetic routing cases were evaluated
  (`routing-v1.0.json`, SHA-256 `d3617240469f7b560e0d78adf9bee7afb500d8ccc650d9eac39bc76f7b952856`).
- Jev produced 91 correct routes out of 100 on this dataset.
- Claude produced 90 correct routes out of 100 on this dataset.
- Jev's complete, paced baseline had a mean provider latency of
  approximately 291.3ms (p50 273ms, p95 455ms).
- Claude's complete baseline had a mean provider latency of approximately
  1,643.2ms (p50 1,473ms, p95 2,418ms).
- The offline Hybrid threshold simulation reached 92.0% final accuracy at
  thresholds 0.60, 0.70, 0.80, and 0.90.
- Increasing simulated fallback from 11 Claude calls (threshold 0.60) to
  27 Claude calls (threshold 0.90) did not change the simulated final
  accuracy on this dataset (92.0% at both).
- Two Jev routing errors occurred at confidence ≥0.90 (RC-048 at 0.99,
  RC-049 at 0.94).
- Claude's independently-recorded baseline decision produced the same
  wrong route (GITHUB, expected JIRA) as Jev on both RC-048 and RC-049.
- The original, unpaced full Jev run encountered 70 HTTP 429 (rate-limit)
  responses out of 100 attempts.
- A subsequent, complete, separately-run Jev baseline using a fixed
  2000ms benchmark-pacing configuration completed 100/100 provider
  decisions with zero HTTP 429 responses in that run.
- Out of 100 cases, both providers were correct on 87, Jev alone was
  correct on 4, Claude alone was correct on 3, and both were wrong on 6.
- The two providers chose the same observed route on 91 cases and
  different routes on 9.

## Findings Requiring Qualification

Statements that are valid only with their stated context attached — never
repeated without it:

- "~100x lower estimated benchmark cost" — valid only as: *this specific
  100-case dataset*, *this specific pricing configuration
  (`pricing-v1-2026-09-22`)*, *estimated API cost, not a measurement of
  general provider economics*, and *not inclusive of Claude's
  general-purpose capability beyond routing*.
- "~5.6x latency difference" — a *point-in-time benchmark observation*
  under specific network conditions on specific dates, not a guaranteed or
  universal latency ratio between the two providers.
- "91/100 vs. 90/100" — a one-point difference on 100 synthetic cases,
  explicitly not framed anywhere in this project as evidence of general
  routing superiority.
- "100/100 decisions, zero 429s" (paced run) — true for *that specific
  run*, not a guarantee about any future run at the same or a different
  pacing value.

## Unsupported Conclusions

Explicitly **not** established by this experiment — never claimed
anywhere in this repository's documentation:

- Jev is generally better than Claude.
- Jev is generally more accurate than Claude.
- Jev is universally ~100x cheaper than Claude.
- Jev is universally ~5x (or any fixed multiple) faster than Claude.
- Claude is poor at routing tasks in general.
- The Hybrid strategy always improves accuracy.
- Any of the five tested thresholds (0.60/0.70/0.80/0.90/0.95) is optimal
  or production-ready.
- Jev's confidence score is a calibrated probability of correctness.
- A 2000ms pacing interval guarantees avoidance of future rate limits.
- These results generalize to production traffic, a different dataset,
  or different model versions than the ones tested.
- Cross-system requests are generally hard for Jev, for Claude, or for
  language models in general — the small per-category samples here (as
  few as n=5) support a statement about *these specific cases*, not a
  general claim.

## Key Failure Evidence

- **Type A — low-confidence, correctable:** RC-060, RC-067, RC-076 (Jev
  wrong, low confidence, Claude's independent answer correct; corrected
  at every tested threshold).
- **Type B — correct decision regresses on fallback:** RC-066, RC-086 (all
  thresholds), RC-056 (0.95 only) (Jev correct, escalates anyway, Claude
  wrong).
- **Type C — shared error:** RC-035, RC-046, RC-048, RC-049, RC-065,
  RC-070 (Jev wrong, Claude also wrong, independently; escalation cannot
  repair these by construction).

**RC-048 and RC-049** are the most architecturally significant cases in
this dataset: both are high-confidence Jev errors (0.99 and 0.94), and in
both, Claude's independently-recorded decision agrees with the wrong
answer. RC-048 never even reaches the fallback mechanism (its confidence
exceeds every tested threshold); RC-049 does reach it (at 0.95 only) and
is still not corrected. **Fallback substituting one provider's answer for
another's is not the same operation as independently verifying an
answer** — these two cases are the direct evidence for that distinction,
not a general claim that no model would get them right.

## Architectural Evidence

**Decision ≠ Authorization ≠ Execution:** `evaluatePolicy(action: Action)`
(`src/policy/policy-engine.ts`) accepts only an `Action` — no confidence,
no model identity, no request context. This was true throughout every
phase of the experiment; nothing observed here required or suggested
changing it. The highest-confidence decision recorded in the entire
benchmark (0.99, RC-048) carried the same authorization weight as any
other — none, since the policy layer cannot see confidence at all.

**Fallback ≠ Verification:** Hybrid's Claude fallback receives only the
original request text — never Jev's route, confidence, or the fact that
Jev was consulted. It cannot check Jev's work because it has no access to
it; it can only answer independently. RC-048/RC-049 are the direct
evidence that this distinction has real consequences, not just a
terminology preference.

## Operational Evidence

**Provider response latency** (how long one call takes to return) and
**operational throughput** (how many requests can be sent per unit time
before being rejected) are different properties, and were measured
separately throughout. Jev's per-call latency was fast in both the
unpaced and paced runs (~283–314ms range across both); the unpaced run's
70 failures were a throughput/rate-limit problem, not a latency problem —
fixing pacing (a benchmark-execution change) resolved it without any
change to Jev's decision quality or per-call speed.

## Limitations

See [`benchmark-summary.md`](benchmark-summary.md#limitations) and
[`src/benchmark/limitations.ts`](../../src/benchmark/limitations.ts) for
the canonical limitations list — not duplicated here.
