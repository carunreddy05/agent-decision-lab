# Phase 5A — Claude Research Checkpoint (RESEARCH ONLY, no implementation)

Date: 2026-09-22. No packages installed, no credentials created, no API
calls made, no dataset/spec changes. Sources: the bundled `claude-api`
skill (Anthropic's own reference material, TypeScript-specific), plus a
live fetch of claude.com/pricing to confirm current rates aren't stale
relative to the skill's cached model table (dated 2026-06-24 internally).

---

## 1–4. API path, model, identifier, and why

**Recommended API path: the Messages API (`client.messages.create`), forced
tool use — not the Tool Runner.** The Tool Runner exists to drive a
multi-turn agentic loop where Claude calls tools, gets results, and
continues; our task is one request in, one structured answer out, with no
loop. Anthropic's own guidance table for "Classification, summarization,
extraction, Q&A" names the plain Messages API as the right tier, not an
agent surface — using the Tool Runner here would be reaching for
orchestration machinery the task doesn't need.

**Recommended model: `claude-sonnet-5`** — not the largest/most expensive,
per your explicit instruction.

| Candidate | Input/Output per 1M | Tier |
|---|---|---|
| Claude Haiku 4.5 | $1.00 / $5.00 | smallest |
| **Claude Sonnet 5** | **$2.00 / $10.00** | **mid — recommended** |
| Claude Opus 5 | $5.00 / $25.00 | largest |

**Why Sonnet 5 over Haiku 4.5 or Opus 5:** Opus 5 is 2.5x the cost of Sonnet
for a bounded 5-way classification task — using it would make this a
comparison against an unnecessarily powerful, unnecessarily expensive
model, undermining the "is a specialized decision model even needed"
question the whole lab exists to ask. Haiku 4.5 is the cheapest option, but
choosing the smallest model risks the opposite failure: if Claude loses to
Jev, a critic could reasonably say the baseline was a strawman, not a fair
general-purpose LLM. Sonnet 5 is Anthropic's current mid-tier "workhorse"
model — capable, current, and representative of what a team would actually
reach for to solve this kind of problem without deliberately over- or
under-powering the comparison. It also supports the structured-output
mechanism used below.

**Exact model identifier: `claude-sonnet-5`.**

**Is it pinned or an alias?** **It's an alias, not a dated snapshot — a real
reproducibility limitation, disclosed rather than glossed over.** The
skill's own guidance is explicit and repeated: *"Use only the exact model
ID strings from the table — they are complete as-is; never append date
suffixes... never `claude-opus-5-20260401` or any other date-suffixed
variant."* Current-generation models (the 5-family, including Sonnet 5) do
not expose a dated-snapshot identifier the way some older-generation models
did on some platforms (e.g. Vertex AI's `@20251101`-style suffixes are only
mentioned for older models). This is mechanistically different from Jev's
situation — there's no separate "resolved provider" routing step, and
`response.model` should simply echo back `claude-sonnet-5` — but the
practical reproducibility guarantee is the same shape: **we cannot pin to a
specific dated build via the request itself.** Anthropic's stated practice
is that a named model ID doesn't change behavior after release (unlike an
explicit `-latest` alias), but that's a policy statement, not a
cryptographic pin. Record `requestedModelIdentifier: "claude-sonnet-5"` and
`resolvedModelIdentifier: null` with the same honest framing used for Jev.

---

## 5. Model selection tradeoff (explained before choosing)

Already covered in §1–4: the tradeoff is capability/cost vs. baseline
credibility. Sonnet 5 was chosen as the point that satisfies every stated
criterion (current, structured-output-capable, reproducible up to the alias
limitation, meaningfully cheaper than Opus for ~100 repeated calls,
genuinely representative of general-purpose reasoning, stable documented
API, low single-digit-second latency expected for a short classification
prompt) without optimizing toward the locked dataset in any way — this
decision was made before looking at `routing-v1.0.json` again.

---

## 6–7. Structured output and no fabricated confidence

**Mechanism: forced tool use with `strict: true`, not `output_config.format`.**
Both are documented, GA structured-output mechanisms (Anthropic's own
architecture note: *"Structured outputs — constrains the Messages API
response format (`output_config.format`) and/or tool parameter validation
(`strict: true`)"*). The `output_config.format` path is demonstrated in the
skill via `client.messages.parse()` + **Zod** (`zodOutputFormat(schema)`).
This project's own convention (`CLAUDE.md`: *"No zod — provider output is
validated with hand-rolled type guards"*) argues against adding a
schema-definition library just for this. Forced tool use with a raw JSON
Schema needs no such dependency and is equally official and GA:

```typescript
tools: [{
  name: "select_route",
  description: "Select exactly one supported route for this developer-support request.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      route: { type: "string", enum: ["DIRECT_ANSWER", "DOCS", "GITHUB", "JIRA", "REJECT"] }
    },
    required: ["route"],
    additionalProperties: false
  }
}],
tool_choice: { type: "tool", name: "select_route" },
```

`strict: true` guarantees the returned `tool_use.input` validates exactly
against this schema — Claude cannot return a sixth value or a malformed
shape. Minimal schema, exactly as instructed: `{"route": "GITHUB"}`, no
explanation field, no reasoning field.

**No fabricated confidence — by construction, not by discipline.** The tool
schema has no `confidence` property, and nothing in this design asks Claude
to self-report certainty. `RoutingDecision.confidence` and `.probabilities`
will simply be `undefined` for the Claude provider — this is valid per the
existing domain type (both fields are already optional) and mirrors exactly
how `evaluateEscalation` already handles an undefined confidence for any
provider (`NOT_APPLICABLE`, not an error).

**Thinking:** recommend **`thinking: {type: "disabled"}`**, not adaptive.
Sonnet 5 defaults to adaptive thinking if `thinking` is omitted, which would
add latency and billed reasoning tokens to a task that needs neither — and
your instruction is explicit that hidden reasoning must not be requested or
stored. Sonnet 5 documents `{type: "disabled"}` as accepted. **One caveat
worth flagging, not resolved by research alone:** the skill documents a
"disabled thinking" failure mode (occasional tool calls leaking into
visible text instead of a `tool_use` block) — but only for **Opus 5**
specifically, not Sonnet 5. I'm not aware of a reason it would reproduce on
Sonnet 5, and forced tool choice further constrains the output shape, but
this is exactly the kind of thing only a live smoke test (Phase 5B, with
your separate approval) can confirm, not documentation research.

---

## 8. RoutingDecision normalization — no contract issue found

The existing `RoutingDecision` type poses **no problem**: `confidence` and
`probabilities` are already optional, `assertValidRoutingDecision` doesn't
require them, and `evaluateEscalation` already branches correctly on
`confidence === undefined`. **No domain change needed for Claude** — this
is a case where the Phase 4 groundwork already generalizes. Fields to
populate:

| Field | Source |
|---|---|
| `route` | forced tool call's `input.route` |
| `provider` | constant `"claude"` |
| `model` | `response.model` (echoes `claude-sonnet-5`) |
| `routingSpecVersion` | our own constant, same `routing-spec-v1` |
| `latencyMs` | client-measured (no documented server-timing field, same situation as Jev) |
| `usage.inputTokens` / `outputTokens` | `response.usage.input_tokens` / `.output_tokens` |
| `confidence`, `probabilities` | left `undefined` — never populated |
| `rawMetadata.requestId` | the Message object's `id` (a stable `msg_...` field on every Anthropic Messages API response — this is core, long-stable API surface, not a 2025/2026 drift point) |
| `rawMetadata.requestedModelIdentifier` | `"claude-sonnet-5"` |
| `rawMetadata.resolvedModelIdentifier` | `null`, with the same explanatory note pattern as Jev |

---

## 9. Version/reproducibility — recorded plainly

Covered in §1–4: `claude-sonnet-5` is an alias with no request-time pin.
Recording `requestedModelIdentifier`/`resolvedModelIdentifier: null` mirrors
the Jev pattern exactly, so a future benchmark artifact treats both
providers' reproducibility limitations the same way rather than making Jev
look uniquely unpinned.

---

## 10. Authentication

**Official environment variable: `ANTHROPIC_API_KEY`** (per the skill's
Authentication Quick Reference — this is also already the exact placeholder
sitting in this project's `.env.example` from an earlier phase, so no
change is needed there beyond removing the "added in Phase 5" comment once
implemented). The zero-arg `new Anthropic()` client picks it up
automatically; no key was created, and none will be requested via chat.

---

## 11. Dependencies

**Add `@anthropic-ai/sdk` — Anthropic's official first-party SDK.** This is
categorically different from the "no zod" convention: it's the vendor's own
client (the skill is explicit that raw HTTP is only for projects with no
official SDK, or an explicit user request for cURL — neither applies here),
directly analogous to how `@typesafe-ai/sdk` would have been the equivalent
choice for Jev's *direct* API (we used native `fetch` for Jev specifically
because we went through Vercel's Gateway with a thin, already-simple JSON
contract, not because SDKs are disfavored in general). No Zod dependency —
the structured-output mechanism chosen (§6) needs only a raw JSON Schema
already expressible in plain TypeScript. No LangChain/LangGraph/CrewAI —
not applicable; this is a single Messages API call.

---

## 12. Error mapping — reuses the Phase 4 taxonomy, no new types

The SDK's typed exceptions map cleanly onto the taxonomy hardened in Phase
4 — no Claude-specific error classes needed:

| Anthropic SDK exception | HTTP | Domain error |
|---|---|---|
| `Anthropic.AuthenticationError` | 401 | `ProviderAuthenticationError` |
| `Anthropic.PermissionDeniedError` (if applicable) | 403 | `ProviderAuthorizationError` |
| billing/credit exhaustion (if surfaced this way) | 402 | `ProviderBillingError` |
| `Anthropic.BadRequestError` / `NotFoundError` / `ConflictError` / `UnprocessableEntityError` | 400/404/409/422 | `ProviderRequestError` |
| `Anthropic.RateLimitError` | 429 | `ProviderRateLimitError` (capture `retry-after` the same way as Jev) |
| `Anthropic.InternalServerError` / `APIConnectionError` | 5xx / network | `ProviderUnavailableError` |
| a request that times out | — | `ProviderTimeoutError` (`origin: "client"` for our own abort; investigate whether Anthropic ever returns a request-timeout-shaped 5xx worth treating as `"upstream"`, mirroring Jev's 504 case) |
| successful response whose tool call doesn't validate (should be rare given `strict: true`, but not impossible) | — | `InvalidProviderOutputError` |

This is the exact category set Phase 4 closed with — reusing it here is the
point of having generalized it.

---

## 13. Timeouts and retries

**SDK defaults, per the skill:** timeout 10 minutes; `max_retries` **default
2**, automatically retrying 408/409/429/5xx and connection errors. For
benchmark reproducibility, this default retry behavior should be **made
explicit, not left implicit** — the same principle Phase 4 applied to Jev
("no hidden retries changing what latency/failure-rate mean"). Recommend
constructing the client with an explicit, low timeout appropriate to a
short classification call (well under the 10-minute default — something in
the same neighborhood as Jev's 10s) and **`maxRetries: 0`** for the
benchmark path, so a recorded failure or latency figure means what it says.
This is a recommendation for Phase 5B implementation, not applied yet.

---

## 14. Usage and cost

Available: `response.usage.input_tokens`, `output_tokens`. Cache-related
fields (`cache_creation_input_tokens`, `cache_read_input_tokens`) exist but
are only non-zero if we opt into caching (§15) — we're not, so they'll
read zero/absent by design, not by omission.

**No dollar cost field is returned by the Messages API directly** (unlike
Jev via the Vercel Gateway, which does return `providerMetadata.gateway.cost`
as a real, provider-reported figure). This is an asymmetry between the two
providers worth naming plainly in §26 below: **`providerReportedCostUsd`
will be `undefined` for Claude** — not fabricated, not backfilled — while
`estimatedCostUsd` is computed the same way Jev's is, from a versioned
pricing constant (confirmed live today: $2.00 / $10.00 per 1M
input/output).

---

## 15. Prompt caching

**Not enabling it, per your instruction not to enable explicit caching
without a deliberate decision.** Caching is opt-in via `cache_control`
breakpoints — nothing is cached automatically. Worth naming precisely: our
100-case benchmark sends the *same* `routing-spec-v1` system prompt +
tool schema on every call, with only the user prompt varying — this is
exactly the shape caching is built for, and enabling it later would
predictably cut input-token cost on calls 2 through 100 (cache read at
$0.20/MTok vs. $2.00/MTok full price). Flagging as a natural, deliberate
future optimization, not doing it now — and if we ever do, `estimatedCostUsd`
math and any Jev-vs-Claude economics comparison must clearly state whether
caching was active, since it would make Claude's real-run economics look
different from a naive per-token estimate.

---

## 16. UI

Deferred to Phase 5B, after mocked tests pass — same sequencing as Jev.
Plan: add "Claude" as a third `PROVIDER_OPTIONS` entry; `ResultView`
already renders `confidence`/`probabilities` conditionally (`final.confidence
!== undefined`, `final.probabilities &&`), so a Claude decision with both
`undefined` will correctly show neither — no code change needed there
beyond wiring the new provider through, and no fake confidence bar per your
explicit instruction.

---

## 17. Policy boundary

No design questions here: `evaluatePolicy(action: Action)`'s signature
already structurally cannot see which provider produced the route (Phase 1
guarantee, unchanged). A Claude-derived route flows through the identical
`deriveAction` → `evaluatePolicy` path Jev and Mock already use. Will add a
test mirroring Phase 4's "no policy bypass" test with a Claude-shaped
decision, for the same documentation-of-a-structural-guarantee reason.

---

## 18–19. No Hybrid, no benchmark

Confirmed understood and not touched. Jev-only and Claude-only remain
fully independent provider implementations in this phase.

---

## 20. Open questions requiring your decision

1. **Thinking-disabled behavior on Sonnet 5** (§6/§7) — the one thing
   research can't settle; needs a live smoke test to confirm, same pattern
   as Phase 4's Jev verification.
2. **Explicit `maxRetries: 0` for the benchmark path** (§13) — recommended,
   but confirming you want retries fully off (vs. e.g. allowing the SDK's
   default 2 retries with the count recorded) is your call, same as the
   "no aggressive retries" principle from Jev.
3. **Cost asymmetry is real and unresolved by design** (§14) — Claude has
   no provider-reported dollar figure the way Jev's Gateway does. Flagging
   now so it doesn't surprise anyone when the eventual comparison report
   can show `providerReportedCostUsd` for Jev but not for Claude.

## 21–27. Fairness review

Nothing found that threatens fairness against Jev: both providers get the
identical `routing-spec-v1` semantics, both return a single constrained
enum value with no self-reported confidence signal baked in by us, both
have an alias-only (not dated-pinned) model identifier and disclose that
identically, and both go through the exact same `derive-action` → `policy`
→ `execution` pipeline with no provider-aware branching. The one structural
asymmetry (Jev reports a native confidence signal; Claude, by design, does
not) is not a fairness bug — it's the actual experimental question Phase 6
exists to explore (does a specialized decision interface's uncertainty
signal earn its keep against a baseline that has none), not something to
paper over by inventing a fake Claude confidence number.

---

## Live smoke-test record

**⚠ SMOKE TEST ONLY — NOT BENCHMARK EVIDENCE.** Three requests through the
real, corrected `ClaudeRouterProvider` code path, made to validate the
integration — not to measure accuracy, cost, or latency. Not added to
`routing-v1.0.json`, and no routing-quality, speed, or price conclusion
should be drawn from any of these. Prompt used throughout (novel, not from
the dataset): *"Find the pull request that introduced request tracing in
the inventory service."* Human sanity expectation (not ground truth):
GITHUB.

### Attempt 1 — failed (2026-09-22)

Result: `ProviderRequestError`. At this point the Claude provider had no
diagnostic logging yet (that gap was the actionable finding from this
attempt — see the Jev-adapter-style `[jev-provider-failure]` logger it
motivated us to add). **The exact Anthropic HTTP status and error message
are unavailable and are not being retroactively guessed here.**

### Attempt 2 — failed with full diagnosis (2026-09-22)

After adding the permanent `[claude-provider-failure]` logger. Result:

- HTTP `400`, `BadRequestError`, `errorType: invalid_request_error`
- Anthropic's own safe message: the API key was **not scoped to a
  workspace**, and the request needed either an `anthropic-workspace-id`
  header or a workspace-scoped key
- `requestId`: none returned (this rejection happened early enough that no
  `request-id` response header was attached)
- Provider latency: `210ms`
- Exactly one request, `maxRetries: 0` confirmed (no retry/backoff pattern
  in the fast, single-round-trip latency)

**Account-side action taken, not a code change:** the key in `.env.local`
was replaced with a workspace-scoped key for the Default workspace. The
application code and request shape were not touched.

### Attempt 3 — succeeded (2026-09-22)

| Field | Value |
|---|---|
| Observed route | GITHUB |
| `inputTokens` | 1025 |
| `outputTokens` | 36 |
| `estimatedCostUsd` | 0.00241 |
| `providerReportedCostUsd` | `undefined` (Messages API returns no dollar-cost field — not fabricated) |
| Provider latency | 2869ms |
| Message id | `msg_011CfJgvHPT5bsgTCE6Dtgm4` |
| Requested model | `claude-sonnet-5` |
| Returned model | `claude-sonnet-5` (identical to the requested alias — confirms §1-4's finding that no more-specific resolved identifier is exposed) |
| Resolved concrete model version | **Unavailable** — `resolvedModelIdentifier: null`, as documented in the reproducibility-limitation section above; this success does not change that limitation |
| Confidence | `undefined` |
| Probabilities | `undefined` |
| `routingSpecVersion` | `routing-spec-v1` |
| Derived action | `SEARCH_GITHUB_PR` |
| Policy | `ALLOW` |
| Execution | `success` (2 mock PRs returned) |

**What this one success does and does not establish:** it confirms the
integration is wired correctly end to end — request construction, response
parsing, `deriveAction`, policy, and mock execution all worked without a
code change. It does **not** establish routing accuracy (one prompt is not
evidence of anything about the other 99+), does not establish typical
latency or cost (one call is not a distribution), and the route matching
the human sanity expectation is a wiring sanity check, not a correctness
result.

## Real response validation against mocked assumptions

The successful call validated every documented path our Phase 5B mocked
tests assumed, with no discrepancy and no code change required:

- `content` contained a `select_route` `tool_use` block — confirmed
  (implicitly: `extractRoute()` only succeeds when this is true)
- the tool's `input` contained a valid `route` value — confirmed
- `usage.input_tokens` present — confirmed (1025)
- `usage.output_tokens` present — confirmed (36)
- message id present — confirmed (`msg_011CfJgvHPT5bsgTCE6Dtgm4`)
- model identifier present — confirmed (`claude-sonnet-5`)
- `stop_reason` behavior matched expectations (implicitly `tool_use` — any
  other value would have thrown before a route was produced)
- no provider-native confidence/probability signal was used — confirmed;
  none was requested, none was fabricated

**One explicit non-claim:** cache-related usage fields
(`cache_creation_input_tokens`/`cache_read_input_tokens`) were **not
observable** from this smoke test. `UsageMetadata` doesn't capture them
(caching was never enabled — see §15), and nothing in the adapter logs the
full raw `usage` object. Whether Anthropic returned them as zero or omitted
them entirely is genuinely unknown from this test, and no claim is made
either way.

---

## Sources

- Bundled `claude-api` skill (Anthropic reference material) — model
  pricing table (cached 2026-06-24), authentication quick reference,
  structured outputs section, error-handling quick reference, client
  config (timeout/retries) quick reference, thinking/effort table.
- [claude.com/pricing](https://claude.com/pricing) — live-fetched
  2026-09-22 to confirm Sonnet 5 pricing ($2/$10 per MTok) is not stale
  relative to the skill's cached table; also captured cache read/write
  rates ($0.20/$2.50 per MTok) and the batch-processing discount (50%,
  not used here).
