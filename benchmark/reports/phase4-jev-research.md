# Phase 4 — Jev Research Checkpoint (RESEARCH ONLY, no integration)

Date: 2026-09-21. No packages installed, no credentials created, no API
calls made against any Jev endpoint, no dataset changes, no Claude research
beyond confirming the `RouterProvider` contract stays viable. All facts
below come from official documentation (TypeSafe, Vercel, OpenRouter) or
named independent evaluations, fetched during this session. Nothing is from
model memory — TypeSafe AI publicly launched Jev on **2026-09-15**, six days
before this research, so pre-training knowledge would be worthless here.

**Verification note (why this took extra care):** the first search pass
surfaced a swarm of small, similarly-named sites (jevai.org, jevapi.org,
jevtypesafeai.com, tokenra.io, and others) all describing Jev in polished,
consistent terms — the profile of an SEO/content-farm cluster that often
appears around a hyped launch. Before trusting any of it, I independently
verified TypeSafe AI and Jev through TechCrunch, Yahoo Finance, HPCWire, The
Register, and Dealroom (a $40M seed round led by DCVC, announced 2026-09-15,
founded by ex-OpenAI RLHF co-inventor Diogo Almeida). That confirmed the
product is real. Everything specific below (endpoints, schemas, pricing) is
then drawn only from **typesafe.ai / docs.typesafe.ai** (primary) and
**vercel.com/docs** (primary, for the gateway path) — not from the
secondary site cluster.

---

## 1–3. Current official access options, recommendation, and why

Three legitimate, currently-documented access paths were found:

| Path | Official source | Native schema preserved? | Notes |
|---|---|---|---|
| **Direct TypeSafe API** | docs.typesafe.ai | Yes (it's the native schema) | Early access; base URL `https://api.typesafe.ai`, waitlist-gated per TechCrunch ("the company briefly lost the ability to serve users... demand was so high") |
| **Vercel AI Gateway** | vercel.com/docs/ai-gateway | Yes — two sub-paths, both native | (a) TypeSafe-compatible passthrough at `https://ai-gateway.vercel.sh/typesafe` (same request/response shape as direct API, just re-billed through Vercel); (b) a provider-agnostic **evaluation** modality at `/v1/evaluate` that renames `noul`→`boolean` and `noul`-value→`probability` but keeps `choice`/`score` shapes intact |
| **OpenRouter** | openrouter.ai/typesafe | **Unclear/likely no** — OpenRouter documents itself as an "OpenAI-compatible API." Nothing in its docs confirms Jev's typed probability/confidence fields survive that normalization. This is a real risk for our use case, not just a formality. |

Not investigated further: Cloudflare AI docs lists Jev but I did not find
primary confirmation it preserves the native schema either, and it adds a
fourth intermediary for no clear benefit over the two paths above.

**⚠ CORRECTED (see "Addendum: wire-format reconciliation" at the end of this
report):** this recommendation picked the wrong sub-path. A follow-up
documentation check found Vercel's current guidance explicitly recommends
`/v1/evaluate` for new integrations, not the compatibility passthrough
below. The reasoning that Vercel-over-OpenRouter was correct still stands —
only the choice *between the two Vercel sub-paths* was wrong. Left in place
rather than deleted, per the dataset-integrity norm this project already
applies to ground truth: corrections are recorded, not silently overwritten.

**Recommendation (superseded): Vercel AI Gateway, via the TypeSafe-compatible
passthrough (`https://ai-gateway.vercel.sh/typesafe/v1/systemone`).**

**Why:**
- Preserves TypeSafe's native `choice`/`score`/`noul` response shape exactly
  — no risk of an OpenAI-compatible wrapper silently dropping the
  probability distribution or confidence scalar our entire escalation
  architecture depends on.
- Returns a **provider-reported dollar cost per request**
  (`provider_metadata.gateway.cost`) that the direct TypeSafe API does not
  expose in its own response body (direct API returns only token counts).
  This is a meaningful, unprompted win for "cost visibility" and
  "transparent usage metadata" — we get real per-call cost without
  hardcoding a price constant that goes stale.
- Doesn't require joining TypeSafe's own waitlist first if a Vercel team
  already exists; billing runs through Vercel instead.
- Migration to direct TypeSafe later is a two-line change (swap base URL
  and API key env var) if we ever want to leave the gateway — confirmed
  directly in Vercel's own migration docs.
- One meaningful caveat: Vercel's page states usage may require "a card on
  file" even during the free promotional period, or requests fail with
  `customer_verification_required`. Not a blocker, just a setup step to
  plan for later.

I did not choose OpenRouter despite it being "simple," because simplicity
that hides the probability/confidence semantics this whole experiment
depends on is exactly the failure mode your instructions told me to avoid.

---

## 4–5. Exact provider and model identifier

**⚠ CORRECTED:** `jev-1.13.0` below is TypeSafe's own direct-API version
string — it is not documented anywhere in Vercel's Gateway examples for
either sub-path, and was not confirmed to work there. The actual identifier
used for our Gateway integration is `typesafe-ai/jev`; see the addendum for
the full reconciliation and the reproducibility tradeoff it introduces.

- **Provider:** TypeSafe AI ("typesafe-ai" as the resolved provider slug
  through Vercel; "typesafe" as OpenRouter's org slug).
- **Current model:** `jev-1.13.0` (per docs.typesafe.ai/models — this is the
  direct-API identifier, not what Vercel's Gateway examples use).
- **Aliases:** `jev-latest` → `jev-1.13.0` (stable default); `jev-preview` →
  currently identical to `jev-latest` (no distinct preview build yet).
- **Path-specific identifier strings:**
  - Direct TypeSafe API / Vercel TypeSafe-passthrough: `"jev-latest"` (or
    pin `"jev-1.13.0"` for reproducibility — **recommended for our
    benchmark**, since `jev-latest` can silently repoint to a new version
    mid-run).
  - Vercel evaluation modality / AI SDK: `"typesafe-ai/jev"`.
  - OpenRouter: `"typesafe/jev-1.13"` or `"~typesafe/jev-latest"`.

**Documentation sources:** docs.typesafe.ai/models; vercel.com/docs/ai-gateway/sdks-and-apis/typesafe; openrouter.ai/typesafe/jev-1.13.

---

## 6. Authentication (nothing created yet)

- **Type:** Bearer token, `Authorization: Bearer <API_KEY>` header.
- **Obtained from:** `console.typesafe.ai` (direct path) — currently
  early-access/waitlist-gated per TechCrunch coverage of demand — or from
  an existing Vercel team's AI Gateway settings (no separate TypeSafe
  account needed for the gateway path).
- **Account required:** a TypeSafe account (direct) or a Vercel account +
  team (gateway).
- **Billing setup:** gateway path may require a card on file even for the
  free promotional window (Vercel docs: `customer_verification_required`
  otherwise). Direct path: standard TypeSafe billing once past early
  access.
- **Expected environment variable:** `TYPESAFE_API_KEY` (direct path,
  confirmed in the Python SDK's documented constants) or
  `AI_GATEWAY_API_KEY` (gateway path, confirmed in Vercel's migration
  example). **No credentials were created. No `.env.local` was touched.**

---

## 7. API / SDK shape recommendation

Official TypeSafe SDKs exist for Python and JavaScript/TypeScript
(`@typesafe-ai/sdk`), both thin typed clients around the HTTP API — not
heavy frameworks. Given `AGENTS.md`'s "minimal dependencies" rule and that
this project is already TypeScript/Next.js, the tradeoff is:

- **Raw `fetch` against the Gateway URL** — zero new dependency, and the
  request/response shape is a handful of flat JSON fields (`state`, `model`,
  `questions` in; `answers`, `usage`, `provider_metadata` out). This is
  small enough that hand-rolling it fits the project's existing pattern of
  hand-rolled validation (`src/domain/validate.ts`) instead of pulling in a
  schema library.
- **`@typesafe-ai/sdk`** — would add one small, officially-supported
  dependency and give typed request/response objects for free, at the cost
  of one more thing to track version bumps for.

**Recommendation: raw `fetch`, no new dependency**, matching this repo's
existing "no zod, hand-rolled type guards" convention. The response shape is
simple and stable enough (3 primitives, flat JSON) that a `JevRouterProvider`
can validate it the same way `assertValidRoutingDecision` already validates
mock provider output — no SDK needed to get type safety at our boundary.

---

## 8–9. Decision primitives (verified current, not assumed from memory)

Three primitives currently exist. The user's message listed "choice, score,
boolean probability, typed decision, multiple simultaneous questions" as
examples from earlier research — all still current, with one naming
wrinkle:

| Primitive (native TypeSafe name) | What it does | What it returns | Relevant to us? |
|---|---|---|---|
| **Choice** | Selects one option from a named set (`criteria`: option → description) | `choice` (selected key), `probabilities` (per-option distribution), `confidence` (derived scalar) | **Yes — directly maps to our 5-route decision.** |
| **Score** | Rates state against an ordered scale (`criteria`: array of labels, low→high) | interpolated `score`, `probabilities` per rung, `confidence` | Not needed for routing; could matter for a future risk-scoring feature, out of scope now. |
| **Noul** (native) / **Boolean** (Vercel's gateway-normalized name for the same primitive) | Yes/no question | a single `probability`/`noul` value 0–1, no separate confidence ("the value already is the certainty: 0.5 means undecided") | Not our primary route decision, but notable: a request can carry **multiple named questions against the same `state` in one call** — e.g. a `route` Choice question and an `isDestructive` Boolean question, evaluated together. Flagging this as a real future option, not proposing to build it now — our current destructive-intent check is a separate regex step in `deriveAction`, and this research checkpoint isn't the place to redesign that. |

**Multiple simultaneous questions:** confirmed current and documented
(`questions` is a map; Vercel's own example asks three at once). Relevant
mainly as a future option, not something this phase changes.

---

## 10–11. Probability semantics — the most important question

**What TypeSafe's own docs say (`docs.typesafe.ai/confidence`, quoted
directly, not paraphrased):**

- `probabilities` is "the probability distribution across options"; a
  concentrated distribution means confident, a spread one means uncertain.
- `confidence` is described as **"a statistic computed from the probability
  distribution"** — an explicit derived summary number, not an independent
  measurement of correctness.
- On calibration, the docs define the *concept* ("if a model is well
  calibrated, events assigned an 80% probability should occur about 80% of
  the time") but **do not assert that Jev has been measured or verified as
  calibrated for any given domain.** The closest operative sentence: **"The
  correct threshold values depend on your domain and the performance of the
  model for your use case."** That is TypeSafe itself telling integrators
  not to assume calibration transfers to a new domain — ours included.
- No calibration benchmark, ECE figure, or third-party audit is cited on
  that page. No disclaimer explicitly says "don't treat confidence as
  probability of correctness" — but none of the documentation claims that
  equivalence either. It's an absence of a claim, not a denial of one; I'm
  not inferring more than that.

**What independent (non-TypeSafe) evaluation found**, from named,
inspectable sources — treated as evidence, not certainty, since I have not
reproduced these results myself:

- `scienthoon/jev-ood-calibration` (GitHub, 4,621 calls, zero API failures):
  on **900 synthetic support tickets** — a domain close to ours ("developer
  support"-shaped decisions) — measured **ECE 0.107, 4.4× a 0.024 noise
  floor**, i.e. real, non-trivial miscalibration out-of-distribution. The
  direction of miscalibration **varied by question type**: Choice questions
  were *overconfident* (needed a temperature refit of 3.29 to correct),
  Boolean questions were *underconfident* (refit 0.66), Score was severely
  overconfident (refit 3.40). The same repo also reports individual cases
  where probability mass didn't behave as expected (one item assigned
  `0.00` to the correct answer). Their own conclusion: **"calibrate per
  question [type], not per model"** — a fixed threshold's safety is
  question-type-dependent, not a property of "Jev" as a whole.
- A second independent benchmark (`beri.net` write-up of a phishing
  classification task) found Jev scored **62.6% asked as a single question**
  vs. **95.0% when the same task was decomposed into five narrower
  questions with fitted weights**. That's strong direct evidence that a
  single top-choice confidence value, used alone, can badly understate what
  the model is actually capable of on a task — and by extension, that a
  single raw confidence number is not a reliable stand-in for "is this
  decision trustworthy."
- Other independent repos report a wide *range* of ECE (0.014 to 0.154)
  across different tasks — reinforcing that calibration is empirically
  task/domain-dependent, exactly as TypeSafe's own hedge implies, not a
  fixed property of the model.

**Direct answers to your explicit questions:**
- Does Jev return a probability for each choice? **Yes**, per-option, in
  `probabilities`.
- Do the values sum to 1? **Documented examples always sum to 1** (e.g.
  `{billing: 1, shipping: 0, technical: 0}`), but independent testing found
  edge cases that didn't behave cleanly (quantization to 0.01, a correct
  answer assigned exactly `0.00`). Treat "sums to 1" as the intended
  contract, not an unconditionally verified guarantee.
- Documented as probability, confidence, score, or something else? **Both**
  — `probabilities` (a distribution) and a separately-derived `confidence`
  scalar. TypeSafe is explicit that `confidence` is a *computed statistic*,
  not an independent correctness signal.
- Is it calibrated? **Not claimed as verified by TypeSafe. Independent
  evidence shows real, direction-varying miscalibration out of
  distribution**, on a task shape similar to ours.
- Can 0.90 legitimately be called "90% probability this decision is
  correct"? **No — not defensible**, per both the absence of that claim in
  official docs and the independent evidence of task-dependent
  miscalibration. I'm treating "confidence," "certainty," and "probability
  of correctness" as three different things throughout this report, as
  instructed.

### 11. Threshold-experiment validity verdict

**YES, WITH LIMITATIONS.**

The experiment ("if topChoiceValue ≥ threshold: accept Jev, else: escalate
to Claude") is defensible to *run*, because Jev does output a documented,
non-arbitrary uncertainty signal derived from an actual probability
distribution — this isn't a fabricated number. But it cannot be presented
as measuring "how often Jev is right" without us actually measuring that
ourselves.

**Precise limitations:**

1. **No transferable calibration claim exists.** TypeSafe's own docs say
   calibration is domain-dependent; independent evaluation confirms
   meaningful, direction-varying miscalibration out of distribution, in a
   domain similar to ours. A single global threshold (e.g. 0.80) has no
   basis for being "the right" cutoff for our routing task specifically —
   it's a starting hypothesis to test, not a known-good value.
2. **The direction of miscalibration may not be uniform.** If Choice
   questions (our primitive) tend to run *overconfident* out-of-distribution
   (as the OOD study found), a naive 0.80 threshold could accept
   Jev-generated answers more often than their true accuracy would justify
   — the opposite of the safety margin the architecture assumes.
3. **A single top-choice value may understate what's achievable.** The
   phishing-decomposition finding (62.6% vs 95%) shows Jev's answer quality
   can depend heavily on how a question is posed, not just on the model's
   ceiling capability. Our benchmark asks one Choice question per case,
   which is a reasonable v1 design, but it means we're testing "Jev asked
   the way we asked it," not "the best Jev can do."
4. **Sample size caution.** Our locked dataset has 100 cases. A calibration
   check (bucket by confidence, compare to actual accuracy) needs enough
   cases per bucket to mean anything — 100 cases split across 5 routes and
   3 difficulty tiers will produce small per-bucket counts. Any calibration
   conclusion from this benchmark alone should be described as suggestive,
   not definitive.

**What I recommend (proposal only, not implemented, per your instruction
not to implement an alternative without approval):** run the threshold
architecture as originally designed for v1, but **also record, for every
case, the raw `probabilities` and `confidence` alongside whether Jev's
top choice matched ground truth** — then, in the benchmark report, produce
our *own* calibration check (confidence-decile buckets vs. observed
accuracy) instead of trusting the word "confidence" at face value. This is
exactly what `CLAUDE.md` already commits to ("Never describe Jev's
confidence as calibrated unless calibration is actually measured") — this
just makes it concrete. If our own data shows the same overconfidence
pattern the OOD study found, a **top-1 vs. top-2 margin** or a
**per-difficulty-tier threshold** would be the natural next things to try —
but that's a Phase 6+ decision, not something to build now.

---

## 12–13. Five-route task → Jev primitive, and routing-spec-v1

**Cleanest primitive: Choice.** "Select exactly one supported route" is
precisely what Choice is for — one call, `criteria` keyed by our five exact
`Route` string literals (not full sentences), each mapped to a one-line
capability definition. This also means Jev's `probabilities` object comes
back keyed by our own `Route` values with no translation table needed.

**Proposed `routing-spec-v1`** (a stable capability definition, not
optimized for our 100 cases — the same content already locked into
`routing-v1.0.json`'s conceptual model, just restated as the instruction
text a provider would receive):

```
You are the routing layer of a developer-support agent. Given a request,
choose exactly one of the following five routes — the one that matches
what the user is ultimately asking for, not merely a system or identifier
mentioned in passing.

DIRECT_ANSWER — A supported general software/engineering question,
answerable without consulting any external system.

DOCS — The user wants supported documentation retrieved.

GITHUB — The user wants supported code or pull-request information
searched or read.

JIRA — The user wants a ticket searched, read, or proposes creating one.

REJECT — The request is outside this agent's supported capability
boundary, or asks for an operation this agent does not perform — regardless
of which system the request's subject matter belongs to.

Route based on the final artifact or operation the user is actually asking
for, not on which system's identifier happens to appear in the request. For
example, a request that mentions a ticket ID but asks for the code change
that resolved it routes to GITHUB, not JIRA, because the code is what was
asked for.

REJECT is a capability/routing decision about what this agent can serve.
It is separate from any downstream safety or policy decision about whether
a specific operation is permitted once identified.
```

This is deliberately generic — no case IDs, no answers, no dataset-specific
phrasing (see leakage discussion, §29 below).

---

## 14–15. Routing instructions & spec versioning

Instructions above already: list the five routes and their meanings,
require selecting exactly one, state the final-artifact-over-identifier
principle with a generic (non-dataset) example, and state the
REJECT-vs-policy distinction explicitly.

**Versioning:** `routingSpecVersion: "routing-spec-v1"` must be recorded on
every future benchmark run's output, alongside `datasetVersion` and
`datasetHash`. If the spec text changes after seeing provider results —
even a one-word change — it becomes `routing-spec-v2`, and runs under v1 and
v2 are kept and reported separately, never merged or treated as comparable
without saying so.

---

## 16–17. RouterProvider fit and response normalization

**The existing contract fits. No domain redesign needed.** Mapping:

| `RoutingDecision` field | Source in Jev's Choice response | Notes |
|---|---|---|
| `route` | `answers.route.choice` | Direct match if `criteria` keys are our exact `Route` literals. |
| `provider` | constant `"jev"` (adapter's own value) | Not from the API. |
| `model` | response's `model` field | Recommend pinning `"jev-1.13.0"` in the request rather than `"jev-latest"`, so the response's echoed model string is stable for reproducibility. |
| `confidence` | `answers.route.confidence` | Present per documented schema. |
| `probabilities` | `answers.route.probabilities` | `Partial<Record<Route, number>>` — exact type fit. |
| `latencyMs` | **not provided by the API** — must be client-measured (wall-clock around the fetch call) | See §18 — no server-reported latency field was found in any documented response shape. |
| `usage.inputTokens` / `usage.outputTokens` | `usage.input_tokens` / `usage.output_tokens` (direct/TypeSafe-passthrough) or `usage.inputTokens`/`outputTokens` (Vercel evaluation modality — camelCase) | Field naming differs by path; adapter must normalize whichever path is chosen. |
| `usage.estimatedCostUsd` | **Vercel Gateway path only:** `provider_metadata.gateway.cost` (a precise, provider-reported dollar figure) | This is the strongest practical argument for the Gateway path — direct TypeSafe API does not return a cost field, only token counts, which would force us to hardcode a price constant that can silently go stale. |
| `rawMetadata` | a safe subset of `provider_metadata.gateway` (e.g. `resolvedProvider`, `canonicalSlug`, `generationId`) cast to `SafeMetadata` | Excludes anything not string/number/boolean/null, per the existing type. |

Nothing here required inventing a field the API doesn't provide — where a
value isn't documented (server-side latency), the recommendation is to
leave it unavailable rather than approximate it as something it isn't.

---

## 18. Usage metadata: provider-reported vs. client-measured

- **Available, provider-reported:** input/output token counts (both paths);
  a precise per-request dollar cost (**Gateway path only**, via
  `provider_metadata.gateway.cost` — direct API does not expose this); a
  `generationId` for request-level tracing (Gateway path).
- **Not available from either path, per documentation reviewed:** a
  server-reported processing-time/latency field. `latencyMs` in our domain
  model would have to be **entirely client-measured** (wall-clock around
  the HTTP call) — this must be labeled as such and never presented as a
  server-side timing figure, since none was found in the documented
  response shape.
- Billable units: input tokens only; output is explicitly "free (too cheap
  to meter)" per TypeSafe's own pricing framing — an unusual but clearly
  documented pricing model, not an oversight.

---

## 19. Current official pricing

- **Standard (non-promotional), corroborated by docs.typesafe.ai directly
  and by OpenRouter's independent pricing listing:** input tokens
  **$0.042 per million** (= $42 per billion); output tokens **free**.
  TypeSafe's own docs note this may be a subsidized early-access rate and
  could change — **this is not a published general-availability rate
  card.**
- **PROMOTIONAL:** Jev is **free via Vercel AI Gateway until 2026-09-25**
  (four days after this research, at time of writing) — confirmed via
  Vercel's own AI Gateway model page and changelog, corroborated by
  Vercel's developer relations account. After that date, standard
  per-token gateway billing applies (rate not separately stated by Vercel;
  presumably the same $0.042/M passed through, but not explicitly
  confirmed for the post-promo period).
- **One inconsistency I chose not to trust:** a single lower-quality
  secondary source (an aggregator called "OpenTweet") stated a
  "$0.42/million... at-cost via console.typesafe.ai" figure — 10× the
  figure every other source (including the primary docs.typesafe.ai fetch)
  gives. I'm flagging this rather than silently picking one, but treating
  **$0.042/M as the reliable figure**, since it's corroborated by the
  primary source directly plus an independent pricing aggregator
  (OpenRouter), while the $0.42 figure appeared exactly once in a
  lower-confidence source.

---

## 20. Estimated cost for 100 benchmark cases

**Assumptions (stated, not measured):**
- `routing-spec-v1` instruction text: ~180–220 words ≈ 240–300 tokens.
- Average benchmark prompt: ~15–25 words ≈ 20–35 tokens (checked against
  the actual 100 prompts — most are one sentence).
- `state` + `questions` JSON overhead (field names, criteria descriptions
  for 5 routes at ~10–15 tokens each): roughly 60–90 tokens.
- **Estimated input tokens per request: ~320–425 tokens.**
- Output tokens: free regardless of count, so irrelevant to cost.

**Cost math at the standard (non-promotional) rate, $0.042/million input
tokens:**

```
100 requests × ~375 tokens (midpoint) = ~37,500 input tokens
37,500 / 1,000,000 × $0.042 ≈ $0.0016
```

**Estimated range: roughly $0.0013–$0.0018 for the full 100-case run** at
standard pricing — i.e., effectively negligible regardless of which end of
the token estimate is right. **Under the current Vercel promotion (through
2026-09-25), the run would cost $0.00.** This is a rough order-of-magnitude
estimate only; no API calls were made to measure actual token counts.

---

## 21. Rate limits / quotas

Per docs.typesafe.ai: **250,000 tokens/second** and **1,200 requests/minute**
as two concurrent ceilings, explicitly described as **"adjusting
dynamically... may change without notice as demand scales."** Higher limits
available via custom/enterprise plans (contact sales@typesafe.ai). Nothing
in reviewed documentation specifies a per-day quota or a hard trial-request
cap — **NOT DOCUMENTED / NOT FOUND** for those specifics. At 100 requests
run sequentially or lightly parallelized, our benchmark would come nowhere
near either stated ceiling.

---

## 22–23. Error/failure behavior and domain error mapping

Documented HTTP-level errors (direct API / Gateway passthrough, same
shape): `401` (auth failure), `422` (invalid/malformed request), `429`
(rate limit, "use exponential backoff"), `529` ("temporarily overloaded,
retry after a short delay"). The JS SDK additionally documents exception
classes: `AuthenticationError`, `BadRequestError`, `RateLimitError`,
`APITimeoutError`, `InternalServerError`, `PermissionDeniedError`,
`NotFoundError`, `UnprocessableEntityError`.

Mapping onto our three existing domain errors:

| Jev condition | Fits cleanly into... |
|---|---|
| Client-side timeout (`APITimeoutError`, no response in time) | `ProviderTimeoutError` — clean fit. |
| `529` overloaded / `InternalServerError` | `ProviderUnavailableError` — clean fit. |
| Malformed response from Jev (fails our own schema validation) | `InvalidProviderOutputError` — clean fit, same role `assertValidRoutingDecision` already plays for the mock provider. |
| `401` authentication failure | **No clean fit.** Not a timeout, not "temporarily unavailable" (it's permanently wrong until a human fixes credentials), not malformed output. |
| `429` rate limit | **No clean fit either.** Distinct from both "down" and "bad output" — it's a policy-shaped rejection of *this* request, often recoverable by waiting, sometimes not (quota exhausted). |

**Gap identified (per your instruction #22, not fixed now):** the current
three-error taxonomy (`ProviderTimeoutError` / `ProviderUnavailableError` /
`InvalidProviderOutputError`) has no natural home for **authentication
failure** or **rate limiting**. Forcing either into `ProviderUnavailableError`
would blur "the service is down, retry later" with "our credentials or
quota are wrong, an escalation/fallback won't fix this." This is worth a
deliberate decision before real integration — I'm not proposing a fix here,
just flagging that the taxonomy doesn't yet cover two conditions Jev's own
docs treat as first-class.

**Uncertainty fallback vs. technical failure fallback:** unaffected by any
of the above — a `401`/`429`/`529`/timeout is unambiguously a **technical
failure fallback** (Jev didn't answer), never confused with **uncertainty
fallback** (Jev answered, confidence was just low). The distinction your
architecture requires holds regardless of how the error gap above gets
resolved.

---

## 24. Security

Design intent (not yet built) keeps credentials server-side only: an eventual
`JEV_API_KEY` (or `TYPESAFE_API_KEY`/`AI_GATEWAY_API_KEY` depending on the
chosen path) would live in `.env.local`, read only inside
`app/api/decide/route.ts` or a server-only provider module — never in
`app/components/` or any client-bundled code. Checked: `.gitignore` already
excludes `.env*` (with `.env.example` explicitly allowed back in) — see the
existing `.gitignore` in this repo. **No credential file was created in this
session.** Future benchmark artifacts (JSON output of a real run) must
never embed the raw API key; only `datasetVersion`, `datasetHash`,
`routingSpecVersion`, model id, and cost/usage numbers belong there.

---

## 25. Claude — confirmed out of scope

No Claude-specific research was done beyond what's needed to confirm the
`RouterProvider` interface stays viable for two providers reporting the
same `RoutingDecision` shape (which it does — Claude's own bring-your-own
schema output would map through the same interface; no interface change is
implied here). No Anthropic credentials, no Claude API research beyond that
one structural check.

---

## 26. No real calls occurred

Confirmed: every fetch in this research pass hit a documentation page
(`docs.typesafe.ai/*`, `vercel.com/docs/*`, `openrouter.ai/*`, and
independent evaluation write-ups on GitHub/beri.net) — never
`/v1/systemone` or `/v1/evaluate` themselves. No API key exists to have
made such a call with.

---

## 27–32. Summary confirmations

**27. Mapping into `RouterProvider`:** confirmed viable, no interface
changes required (§16–17).

**28. `routing-spec-v1`:** proposed in §12–13, generic and case-ID-free.

**29. Benchmark leakage avoidance:** the proposed spec contains zero
benchmark case IDs, zero verbatim benchmark prompts, and its one worked
example ("a request that mentions a ticket ID but asks for the code change
that resolved it") is a paraphrase of the *principle*, not a copy of
RC-038's actual wording — deliberately, so the spec can't be accused of
teaching the model our specific test cases.

**30. Security:** covered in §24 — server-side only, `.env.local` already
gitignored, nothing created yet.

**31. Remaining unknowns:**
- Exact post-promotional (after 2026-09-25) Vercel Gateway pricing wasn't
  separately confirmed — may just be pass-through of the standard
  $0.042/M rate, but Vercel's own page doesn't state this explicitly.
- Whether OpenRouter's OpenAI-compatible wrapper actually drops
  probability/confidence data, or exposes it via some extension field, was
  not confirmed either way — I found no documentation addressing it. Since
  this uncertainty is itself disqualifying for a path we'd depend on for
  probability semantics, I ruled OpenRouter out rather than assume it works.
- No first-party, TypeSafe-run calibration benchmark was found — everything
  on calibration is third-party. That's not necessarily a red flag (a
  vendor grading its own calibration would be less trustworthy anyway), but
  it means our own confidence-vs-accuracy check (§11) is genuinely
  load-bearing, not a formality.
- Direct-API waitlist wait time is unknown; not relevant if the Gateway
  path is chosen.

**32. What current Jev behavior proves we should change in our original
architecture:**
- **Nothing structural.** The `RouterProvider` → `RoutingDecision` → policy
  pipeline holds up exactly as designed; Jev's Choice primitive maps onto
  it cleanly.
- **One real adjustment worth planning for (not building yet):** the
  benchmark report (Phase 7+) should include our own confidence-calibration
  check (§11's recommendation) rather than treating a single 0.80 threshold
  as self-evidently correct — this was always implied by `CLAUDE.md`'s
  "confidence is not correctness" guardrail, but the independent evidence
  found here (direction-varying miscalibration by question type, out of
  distribution) makes it concrete enough to plan for explicitly rather than
  leave as an abstract principle.
- **One taxonomy gap to resolve before real integration:** auth-failure and
  rate-limit conditions don't fit the current three domain error types
  (§22–23). Worth a deliberate decision, not a silent fix.

---

## Sources

- TechCrunch — [A new kind of AI model from a ChatGPT inventor is thrilling developers](https://techcrunch.com/2026/09/18/a-new-kind-of-ai-model-from-a-chatgpt-inventor-is-thrilling-developers/)
- Yahoo Finance / HPCWire / Morningstar / Dealroom / The Register — TypeSafe AI $40M seed coverage (2026-09-15/16)
- [docs.typesafe.ai](https://docs.typesafe.ai/) — models, API reference, confidence/calibration concepts, SDK constants
- [typesafe.ai/blog/introducing-system-one-models-and-jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- Vercel — [changelog: Jev now available on AI Gateway](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway), [TypeSafe API with AI Gateway](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe), [Evaluation modality](https://vercel.com/docs/ai-gateway/modalities/evaluation)
- OpenRouter — [openrouter.ai/typesafe](https://openrouter.ai/typesafe), [openrouter.ai/typesafe/jev-1.13](https://openrouter.ai/typesafe/jev-1.13)
- Independent evaluations (third-party, not TypeSafe): [scienthoon/jev-ood-calibration](https://github.com/scienthoon/jev-ood-calibration) (GitHub); [beri.net — TypeSafe's Jev Scores 62.6% Asked Once and 95% Split Five Ways](https://www.beri.net/article/typesafe-jev-typed-decision-model-calibration-decomposition-shadow-eval)

---

## Addendum: wire-format reconciliation (2026-09-21, before any live call)

You independently checked Vercel's current documentation and flagged a
discrepancy with the implementation built from this report's original
recommendation. This addendum documents what was corrected and why — the
original conclusions above are marked, not deleted, per this project's own
"document the issue, version the correction" norm.

### What was wrong

1. **Wrong Gateway sub-path.** Vercel's `/typesafe/v1/systemone` docs state
   directly: *"If you are writing new code rather than migrating, use the
   evaluation API instead. It is the same capability without TypeSafe
   -specific naming."* Agent Decision Lab has no legacy TypeSafe client to
   migrate, so the compatibility passthrough was the wrong sub-path from the
   start — not wrong because it's older, but because the vendor explicitly
   scopes it to migration.
2. **Wrong model identifier.** Every documented example across both Gateway
   sub-paths and the AI Gateway Models catalog page uses `typesafe-ai/jev`.
   `jev-1.13.0` never appears in any Gateway documentation — it's exclusive
   to `docs.typesafe.ai`'s direct API. Using it against the Gateway was
   never confirmed to work and should not have been assumed.
3. **Wrong confidence location.** `/v1/evaluate`'s own documented Choice
   examples (two independent ones, consistently) never show a `confidence`
   field on the answer — only `type`, `choice`, `probabilities`. The AI SDK
   provider docs (ai-sdk.dev) confirm why: confidence is relocated to
   `providerMetadata.typesafe.confidence[questionId]`. The original
   implementation read `answers.route.confidence`, which is correct for
   TypeSafe's *native* shape (and the compatibility passthrough) but not for
   `/v1/evaluate`.

### What's now used

| | Corrected |
|---|---|
| Endpoint | `POST https://ai-gateway.vercel.sh/v1/evaluate` |
| Model | `typesafe-ai/jev` |
| Choice result | `answers.route.choice` (unchanged) |
| Probabilities | `answers.route.probabilities` (unchanged) |
| Confidence | `providerMetadata.typesafe.confidence.route` |
| Usage | `usage.inputTokens` / `usage.outputTokens` (camelCase; was `input_tokens`/`output_tokens`) |
| Gateway cost | `providerMetadata.gateway.cost` (camelCase wrapper key; same nested shape) |

### Reproducibility tradeoff, accepted deliberately

`typesafe-ai/jev` is Vercel's own catalog identifier for the entire Jev
line — confirmed as the *only* slug on the AI Gateway Models page, with no
version-pinned variant. Neither Gateway sub-path's response reveals a
concrete underlying TypeSafe build number anywhere (not in the top-level
`model` field, which just echoes the alias back; not in
`providerMetadata.gateway.routing`, which only resolves *provider*, not
*version*). A separate, heavier access path — the `@ai-sdk` TypeSafe
provider package, using TypeSafe's own `jev-latest` alias rather than
Vercel's catalog slug — reportedly does echo back a resolved version, per
its own docs, but adopting it would mean taking on the `ai` SDK dependency,
which is a bigger change than this reconciliation warrants.

**Decision: accept the limitation, record it explicitly, do not fabricate a
workaround.** Every `RoutingDecision` from `JevRouterProvider` now carries:

```
rawMetadata.requestedModelIdentifier = "typesafe-ai/jev"
rawMetadata.resolvedModelIdentifier = null
rawMetadata.modelVersionResolution =
  "Concrete underlying Jev version not exposed by the Vercel raw HTTP Gateway response."
```

Any future benchmark report must surface this plainly — a reader should not
have to infer from silence that version pinning isn't happening.

### Pricing re-check

Re-fetched the AI Gateway Models page for Jev directly during this pass: it
states **"$0.042/1M input tokens"** — matching the original research, not
the $0.04 figure you separately observed. Kept $0.042/M as the standard
pricing assumption since it's what the primary source states verbatim right
now; noting the discrepancy rather than silently picking one.

### What did not change

Per your explicit instruction, none of the following were touched: the
dataset (`routing-v1.0.json`, hash reverified unchanged), `routing-spec-v1`
wording, `deriveAction`, `MockRouterProvider`, policy rules, or the
threshold methodology (`confidence >= threshold` / `WOULD_ESCALATE`
unchanged). This was a wire-format correction inside the Jev adapter only.

---

## Live smoke-test record

**⚠ SMOKE TEST ONLY — NOT BENCHMARK EVIDENCE.** A single request through the
real, corrected `JevRouterProvider` code path. Not added to
`routing-v1.0.json`, not treated as a routing-accuracy or cost data point,
and no conclusion about Jev's quality, speed, or price should be drawn from
one call.

### Attempt 1 — failed (2026-09-21)

Endpoint/model/spec as corrected above. Result: generic `ProviderUnavailableError`
("jev is unavailable"), with no server-side record of the actual cause —
the route handler didn't log `.cause` before returning a JSON error. This
gap, not the failure itself, was the actionable finding from this attempt.

### Attempt 2 — failed with real evidence (2026-09-21)

Same request, after adding temporary diagnostic logging. Result: **HTTP 403
Forbidden, empty response body** (no `{message, error_type}` — TypeSafe's
documented error contract wasn't present, suggesting the rejection happened
before reaching the Gateway's own application logic). This confirmed a real
classification gap: 403 was falling into the generic `ProviderUnavailableError`
bucket via `toProviderError`'s `default` branch, which implies "try again
later" for something that isn't a transient outage.

**On cause:** account-side configuration changes (team budget/billing) were
made between this attempt and the next, and the following attempt
succeeded. This is **correlation, not independently established proof** of
the exact mechanism — I did not verify server-side which specific condition
the 403 represented (billing gate, permission scope, or something else),
only that whatever it was, it cleared after those changes.

### Attempt 3 — succeeded (2026-09-22, 02:17:47 UTC)

| Field | Value |
|---|---|
| Provider | Vercel AI Gateway |
| Requested model identifier | `typesafe-ai/jev` |
| `routingSpecVersion` | `routing-spec-v1` |
| Prompt (novel, not in dataset) | "Find the pull request that introduced request tracing in the inventory service." |
| Human sanity expectation (not ground truth) | GITHUB |
| Observed route | GITHUB |
| Observed probabilities | `DIRECT_ANSWER: 0, DOCS: 0, GITHUB: 0.99, JIRA: 0, REJECT: 0.01` |
| Provider-reported confidence | `0.99` |
| Usage | 576 input tokens, 63 output tokens |
| Provider-reported cost | **Gateway reported $0 for this request** — not claiming this means "Jev is free"; not independently confirmed to be the promotional rate |
| Estimated standard-price cost (our own calc, $0.042/M) | `$0.000024192` |
| Client latency | 941ms |
| `generationId` | `gen_01M33EFEE9BRFS858SY3YHHDQK` |
| `resolvedProvider` | `typesafe-ai` |
| Concrete underlying Jev version | **Unavailable through this Gateway path** — `resolvedModelIdentifier: null`, as documented in the reproducibility-limitation addendum above; this single success does not change that limitation |

Every JSON path from the wire-format reconciliation (`answers.route.choice`,
`answers.route.probabilities`, `providerMetadata.typesafe.confidence.route`,
`usage.inputTokens`, `usage.outputTokens`, `providerMetadata.gateway.cost`,
`providerMetadata.gateway.generationId`,
`providerMetadata.gateway.routing.resolvedProvider`) was **PRESENT**, in the
documented shape, with no discrepancy. `JevRouterProvider` required no code
change to handle the real response correctly.

## Post-smoke-test hardening

Triggered directly by the Attempt 2 finding above. Added to the domain
error taxonomy (`src/domain/errors.ts`):

- **`ProviderAuthorizationError`** (401 stays `ProviderAuthenticationError`;
  403 is now this, distinctly — credentials are fine, the account/key isn't
  permitted to do this specific thing).
- **`ProviderBillingError`** (402 — account/billing/verification standing,
  not a generic outage; doesn't claim to know which vendor-specific billing
  condition applied).
- **`ProviderRequestError`** (400/404/409/422 — the provider rejected *our
  outbound request*, never reaching model evaluation at all. Deliberately
  kept separate from `InvalidProviderOutputError`, which is now reserved
  strictly for a *successful* response with unexpected body shape — the two
  represent opposite sides of the exchange failing, and conflating them, as
  422 previously did, would hide which side actually broke).
- **`ProviderTimeoutError`** gained an `origin: "client" | "upstream"`
  field — a client-side `AbortError` and a server-reported HTTP 504 are both
  "timeout, not uncertainty," but they imply different fixes (raise our
  timeout budget vs. nothing we control), so they're now distinguishable
  without a new error class.

Temporary `[jev-diagnostic]` logging (added mid-investigation, deliberately
verbose — full cause chains) was replaced with a permanent, minimal
`[jev-provider-failure]` logger: category, HTTP status if any, the
provider's own safe error fields, and latency — never the API key,
Authorization header, or raw request/response bodies. Network-transport
failures (DNS/TLS/connection errors) remain `ProviderUnavailableError`
unsplit, per the explicit instruction not to over-engineer that case now.

Final mapping table, tests, and full verification are recorded in the Phase
4 closure checkpoint message (not duplicated here to avoid drift between
two copies of the same table).
