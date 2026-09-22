# Phase 8A — Real Benchmark Preflight (PREFLIGHT ONLY, no live calls made)

No Jev request made. No Claude request made. No Hybrid request made. No
benchmark run. No repo state modified.

---

## 1. Repo commit and git status

- Commit: `78d36fc11daf767ffc168e40fd284770eacd38d9`
- Working tree: **clean** (`git status --porcelain` → empty)

## 2. Dataset version / hash / case count

- File: `benchmark/datasets/routing-v1.0.json`
- Version: `1.0`
- SHA-256: `d3617240469f7b560e0d78adf9bee7afb500d8ccc650d9eac39bc76f7b952856`
- Case count: `100`

Unmodified — confirmed via `tests/benchmark/dataset.test.ts` and every dry-run
below independently printing the same hash.

## 3. Routing spec version

`routing-spec-v1` (`src/providers/routing-spec.ts`) — unmodified, shared
identically by both `JevRouterProvider` and `ClaudeRouterProvider`.

## 4. Exact Jev configuration

From `src/providers/jev/config.ts` / `jev-router-provider.ts` (unmodified):

- Provider path: Vercel AI Gateway
- Base URL: `https://ai-gateway.vercel.sh`
- Endpoint: `/v1/evaluate`
- Requested model identifier: `typesafe-ai/jev`
- Resolved concrete version availability: **not exposed** by the raw HTTP
  Gateway response for this alias — recorded explicitly as
  `resolvedModelIdentifier: null` on every decision, never guessed
  (`JEV_RESOLVED_MODEL_VERSION_NOTE`).
- Timeout: `10,000 ms` (`JEV_DEFAULT_TIMEOUT_MS`)
- Retries: none configured beyond the adapter's own single attempt (no
  retry loop in `jev-client.ts`)
- Credential env var: `AI_GATEWAY_API_KEY`

## 5. Exact Claude configuration

From `src/providers/claude/config.ts` / `claude-router-provider.ts`
(unmodified):

- API path: Anthropic Messages API (`@anthropic-ai/sdk`, `client.messages.create`)
- Requested model identifier: `claude-sonnet-5`
- Resolved concrete version availability: **not exposed** — Anthropic's
  current-generation model IDs don't expose a separate dated/pinned version
  through the Messages API; recorded as `resolvedModelIdentifier: null`.
- Thinking configuration: explicitly `{ type: "disabled" }` (not omitted —
  omitting would run adaptive thinking by default on Sonnet 5)
- Retries: `maxRetries: 0` (`CLAUDE_MAX_RETRIES`)
- Timeout: `10,000 ms` (`CLAUDE_DEFAULT_TIMEOUT_MS`)
- Structured-output/tool configuration: forced single tool call —
  `tool_choice: { type: "tool", name: "select_route" }`, `strict: true`,
  `input_schema` restricted to the 5-value route enum, `additionalProperties: false`,
  `max_tokens: 128`
- Credential env var: `ANTHROPIC_API_KEY`

No provider configuration was changed to produce this report.

## 6. Credential presence

Checked presence only — no value, partial value, prefix, or header was ever
printed.

- `.env.local` exists on disk (`git check-ignore` confirms it remains
  gitignored/unstaged) and contains non-empty `AI_GATEWAY_API_KEY=` and
  `ANTHROPIC_API_KEY=` entries (checked by line presence and value
  *length* only — 60 and 108 characters respectively — never the value
  itself).
- **However:** neither variable is present in `process.env` for the actual
  invocation path Phase 8B would use (`npm run benchmark -- --strategy ...`
  / `npx tsx scripts/benchmark-runner.ts ...`). Verified directly:

  ```
  $ npm run benchmark -- --strategy jev --dry-run   # (env-check variant)
  AI_GATEWAY_API_KEY: missing
  ANTHROPIC_API_KEY: missing
  ```

  This is because `.env.local` is auto-loaded only by Next.js's own
  `next dev`/`build`/`start` commands — nothing in `scripts/benchmark-runner.ts`
  or this repo's `tsx` invocation path loads it, and no `dotenv`-style
  loader exists anywhere in the codebase (confirmed via `grep -rn dotenv`).

**Per your instruction ("If either credential is missing, STOP"): this
preflight stops here on the credential-presence check for the actual
runner invocation path.** The keys exist in `.env.local` but are not
currently reaching the process that would make the real calls. This is a
benchmark **setup** gap, not an experimental provider failure — see §22.
Two standard, non-code-behavior-changing ways to close it when you're
ready (not applied here, since this phase is preflight-only):
  - run the command with Node's built-in env-file loader:
    `node --env-file=.env.local ./node_modules/.bin/tsx scripts/benchmark-runner.ts ...`, or
  - export both variables in the shell session before invoking `npm run benchmark`.

Neither requires touching `scripts/benchmark-runner.ts` or any provider file.

## 7. Planned call counts

- Jev calls: **100**
- Claude calls: **100**
- Core total: **200**
- Threshold-simulation additional provider calls: **0** (pure offline
  reconstruction from the two cached result sets — no network calls, per
  Phase 7's `threshold-simulation.ts`, structurally verified to have zero
  provider-related imports)
- Full live Hybrid run: **not included** in the core benchmark, per your
  instruction
- Manual retry budget: **0**

## 8. Execution order (proposed)

A. `JEV_ONLY` full 100-case run
B. Inspect artifact integrity only (manifest fields, case count, no
   accuracy/comparison judgment)
C. `CLAUDE_ONLY` full 100-case run
D. Inspect artifact integrity only (same as B)
E. Offline threshold simulation (reads A's and C's `cases.jsonl`, zero
   provider calls)
F. Analysis/report generation

No comparison of provider performance is made between steps A and C. No
prompt, label, threshold, routing-spec, provider setting, or dataset
change is made based on any intermediate result.

## 9. Concurrency / rate strategy

**Sequential — already how the runner is built, no change proposed.**
Verified directly in `scripts/benchmark-runner.ts`:

```ts
for (const benchCase of cases) results.push(await runJevOnlyCase(benchCase, provider, ctx));
```

One `await`-ed case at a time, no `Promise.all`/batching/concurrency
anywhere in `case-runner.ts` or `benchmark-runner.ts`. No adaptive
concurrency, no burst behavior, nothing to tune — the existing sequential
design is exactly the conservative approach you asked for, so no runner
change is proposed for Phase 8B.

## 10. Failure / retry policy

- No manual retry of individual failed cases.
- No re-running only "bad looking" cases.
- No replacing failed rows — a failed case's row (`succeeded: false`,
  `errorCategory`) stands as the observation.
- Existing provider-level retry behavior is unchanged and untouched:
  - Jev: single attempt, no retry loop in `jev-client.ts`
  - Claude: `maxRetries: 0` (explicit SDK setting)
- **Distinguishing failure classes** (per your instruction, never merged):
  - **A. Experimental provider failure** — an individual case throws
    `ProviderTimeoutError`/`ProviderRateLimitError`/`ProviderUnavailableError`/
    `InvalidProviderOutputError`/etc. *while the run is otherwise healthy*.
    This is preserved as a normal failed-case row and the run continues.
  - **B. Benchmark setup failure** — something prevents the run from
    validly starting or continuing at all: missing/invalid credentials
    (exactly the §6 finding above), the loaded dataset failing validation,
    a malformed CLI invocation, or an unexpected exception outside the
    per-case try/catch in `case-runner.ts`. On this class, the correct
    action is to **stop and report**, not continue collecting rows — which
    is exactly what §6 does here rather than proceeding past a missing
    credential.

## 11. Pricing config / version

From `src/benchmark/pricing-config.ts` (unmodified), labeled explicitly as
**benchmark pricing assumptions this run will record — not a live-verified
current billing rate**:

- `pricingConfigVersion`: `pricing-v1-2026-09-22`
- Jev: input `$0.042` / 1M tokens (standard, non-promotional rate per
  `JEV_PRICING_SOURCE`), output `$0` per this pricing assumption.
  `providerReportedCostUsd` **may** also appear (Vercel AI Gateway returns
  an actual billed-cost field) — kept as a separate figure from our
  `estimatedCostUsd`, never combined, and a `$0` value is never read as
  "Jev is free" (it may reflect an active promotional rate at call time,
  distinct from the standard rate this config uses for estimation).
- Claude: input `$2.00` / 1M tokens, output `$10.00` / 1M tokens (standard
  `claude-sonnet-5` rate per `CLAUDE_PRICING_SOURCE`).
  `providerReportedCostUsd` **does not exist** for Claude — the Messages
  API returns no dollar-cost field, so this is always `undefined`, never
  fabricated as `$0`.

## 12. Rough expected Jev cost (100 cases)

Using the smoke-test-observed usage as a **rough sizing aid only, not
benchmark evidence** (~578 input / 63 output tokens per case; Jev output
priced at $0 in this config):

- Per case: 578 × $0.042 / 1,000,000 ≈ **$0.0000243**
- × 100 cases ≈ **$0.0024**

## 13. Rough expected Claude cost (100 cases)

(~1,023 input / 36 output tokens per case observed):

- Input: 1,023 × $2.00 / 1,000,000 ≈ $0.002046
- Output: 36 × $10.00 / 1,000,000 ≈ $0.00036
- Per case ≈ **$0.002406**
- × 100 cases ≈ **$0.2406**

## 14. Rough total core cost (200 calls)

**$0.0024 (Jev) + $0.2406 (Claude) ≈ $0.243** — a rough sizing estimate
only, not an exact or guaranteed figure. Neither the $0 Jev-output
assumption nor any `providerReportedCostUsd` figure is used to claim
either provider is "free."

## 15. Conservative upper-bound cost

Deliberately pessimistic allowance: **2,000 input tokens/case** for both
providers (well above the ~578/~1,023 observed), and Claude's output
pinned to its **hard `max_tokens: 128` ceiling** (a real configured limit,
not a guess, since the tool-forced call cannot exceed it):

- Jev upper bound: 100 × 2,000 × $0.042 / 1,000,000 ≈ **$0.0084**
- Claude upper bound: input 100 × 2,000 × $2.00/1,000,000 ≈ $0.40, output
  100 × 128 × $10.00/1,000,000 ≈ $0.128 → **$0.528**
- **Core 200-call upper bound ≈ $0.0084 + $0.528 ≈ $0.536**

Both the rough and upper-bound figures are sizing aids, not commitments —
actual token counts depend on the real prompt/response content at call
time.

## 16. Artifact destinations

All under `benchmark/results/` (gitignored, not yet created):

```
benchmark/results/<jev-run-id>/manifest.json
benchmark/results/<jev-run-id>/cases.jsonl
benchmark/results/<jev-run-id>/summary.json
benchmark/results/<jev-run-id>/summary.md
benchmark/results/<jev-run-id>/confusion-matrix.json

benchmark/results/<claude-run-id>/manifest.json
benchmark/results/<claude-run-id>/cases.jsonl
benchmark/results/<claude-run-id>/summary.json
benchmark/results/<claude-run-id>/summary.md
benchmark/results/<claude-run-id>/confusion-matrix.json

benchmark/results/<threshold-sim-run-id>/threshold-analysis.json
benchmark/results/<threshold-sim-run-id>/threshold-analysis.md
```

`scripts/benchmark-runner.ts` calls `mkdirSync(runDir, { recursive: true })`
without an overwrite check — no existing run directory is targeted here
since none exist yet, but note for the record: the runner does not
currently refuse to write into an already-existing run directory (a
same-second re-run producing a colliding run ID is the only realistic
collision path, and run IDs carry second-level timestamp granularity, so
this is a theoretical rather than practical risk — flagged in §22, not
fixed here since this is preflight-only).

## 17. Run-ID approach

`buildRunId(strategy, threshold, now)` (`src/benchmark/manifest.ts`)
produces `YYYYMMDD-HHmmss-<strategy>[-t<threshold*100>]`, e.g.
`20260922-143000-jev-only` / `20260922-143512-claude-only`. This is a
timestamp-based identifier, not a stronger unique ID (no UUID/nonce) — the
design accepted this in Phase 7A as "human-scannable in a directory
listing," and since the two provider runs will be started at different
wall-clock times in the proposed execution order (§8), a same-second
collision between them is not a practical concern. The offline threshold
simulation's manifest/report explicitly reference `sourceJevRunId` and
`sourceClaudeRunId` by their exact directory names (via
`path.basename(config.jevRunDir)` / `path.basename(config.claudeRunDir)`
in `scripts/benchmark-runner.ts`), so provenance is traced by run ID, not
by re-deriving from timestamps.

## 18. Reproducibility fields

Confirmed present on every real-run `manifest.json` (`RunManifest` in
`src/benchmark/manifest.ts`, unchanged from Phase 7): `benchmarkSchemaVersion`,
`runId`, `timestamp`, `gitCommit`, `gitDirty`, `datasetVersion`, `datasetHash`,
`routingSpecVersion`, `strategy`, `requestedModelIdentifiers` (`{jev}` or
`{claude}` depending on strategy — `resolvedModelIdentifier` is recorded
per-case in `cases.jsonl`, not on the manifest, since it can differ
case-by-case in principle even though both adapters currently always
record it as `null`), `pricingConfigVersion`, `nodeVersion`,
`requestedCaseCount`, `actualCaseCount`, `fullDataset`, `dryRun`.

For the offline threshold simulation, `scripts/benchmark-runner.ts`
records `sourceJevRunId`/`sourceClaudeRunId` in the rendered
`threshold-analysis.md`, and every simulated case/aggregate result is
tagged `analysisMode: "OFFLINE_THRESHOLD_SIMULATION"` (`threshold-simulation.ts`).

## 19. Prompt / data integrity

- The exact frozen prompt text (`benchCase.prompt`, verbatim from
  `routing-v1.0.json`) is what's sent to each provider — `case-runner.ts`
  passes `{ prompt: benchCase.prompt }` directly to `provider.decide(...)`,
  no rewriting.
- `promptHash` (sha256 of the exact UTF-8 prompt bytes, `prompt-hash.ts`)
  is stored in every result row.
- The raw prompt is **not** persisted in `cases.jsonl` — verified by
  Phase 7's test asserting the serialized case result never contains
  prompt text.
- The locked dataset remains the sole authoritative source for recovering
  a prompt from its `caseId`.
- No provider-specific prompt adaptation beyond the already-approved,
  shared `routing-spec-v1` (`ROUTING_INSTRUCTIONS`/`ROUTE_CRITERIA` used
  identically by both adapters) — Jev receives the spec via its
  `questions.route.instructions/criteria` fields, Claude via its system
  prompt; both render from the exact same `routing-spec.ts` source.

## 20. Exact benchmark CLI commands (NOT executed)

```
# JEV_ONLY, full 100 cases
npm run benchmark -- --strategy jev

# CLAUDE_ONLY, full 100 cases
npm run benchmark -- --strategy claude

# Offline threshold simulation (template — <jev-run-id>/<claude-run-id>
# filled in with the actual directory names produced by the two runs above)
npm run benchmark -- --strategy threshold-simulation \
  --jev-run benchmark/results/<jev-run-id> \
  --claude-run benchmark/results/<claude-run-id>
```

**Note on `--limit`:** do **not** pass `--limit 100` for the real runs —
passing any explicit `--limit` (even equal to the full dataset size) sets
`fullDataset: false` and triggers a "PARTIAL RUN" banner in the generated
report (confirmed below in §21). Omitting `--limit` entirely is what
correctly yields `fullDataset: true` for a genuine full 100-case run.

## 21. Dry-run outputs (executed)

All four ran with **zero provider calls, zero live-result artifacts**
(`benchmark/results/` still does not exist on disk afterward):

```
$ npx tsx scripts/benchmark-runner.ts --strategy jev --dry-run
{ "strategy": "jev", "datasetHash": "d361724...b952856",
  "requestedCaseCount": 100, "actualCaseCount": 100, "fullDataset": true,
  "providersThatWouldBeCalled": ["jev"], "maxPossibleProviderCalls": 100,
  "pricingConfigVersion": "pricing-v1-2026-09-22",
  "gitCommit": "78d36fc...", "gitDirty": false }

$ npx tsx scripts/benchmark-runner.ts --strategy claude --dry-run
{ "strategy": "claude", ... "actualCaseCount": 100, "fullDataset": true,
  "providersThatWouldBeCalled": ["claude"], "maxPossibleProviderCalls": 100, ... }
```

Also ran with explicit `--limit 100` per your instruction's literal request
— this surfaced the `fullDataset` behavior noted in §20/§22:

```
$ npx tsx scripts/benchmark-runner.ts --strategy jev --limit 100 --dry-run
{ ..., "requestedCaseCount": 100, "actualCaseCount": 100, "fullDataset": false, ... }
$ npx tsx scripts/benchmark-runner.ts --strategy claude --limit 100 --dry-run
{ ..., "requestedCaseCount": 100, "actualCaseCount": 100, "fullDataset": false, ... }
```

Both confirm: 100 planned cases, 100 maximum provider calls, correct
pricing config version, correct model identifiers implied by strategy,
zero provider calls, zero artifacts written. Actual Hybrid dry-run was not
re-run here (already validated in Phase 7 closure; not needed for this
infrastructure check).

## 22. Zero live provider calls confirmation

Confirmed. No `JevRouterProvider`/`ClaudeRouterProvider` was constructed
with real credentials during this preflight — only `--dry-run` invocations
were executed, and `printDryRunPlan` only calls `loadDataset`/`hashDataset`,
never a provider. `.env.local` was read only for key-name/length presence
checks (never its values) and remains gitignored/unstaged throughout.

## 23. Unresolved risks

1. **Credential loading gap (blocking, §6):** the real runner invocation
   path (`npm run benchmark` / `npx tsx scripts/benchmark-runner.ts`) does
   not currently load `.env.local`, so `AI_GATEWAY_API_KEY` and
   `ANTHROPIC_API_KEY` are not present in `process.env` for that path even
   though both are present in the file. A real run today would fail
   immediately with `ProviderAuthenticationError` for both providers — a
   benchmark setup failure, not an experimental one. Needs a decision
   before Phase 8B: either invoke with `node --env-file=.env.local`, export
   both variables in the shell first, or (if you'd prefer) approve a small,
   separate code change to load `.env.local` in `scripts/benchmark-runner.ts`
   — no such change has been made.
2. **`--limit N` where N equals the full dataset size still sets
   `fullDataset: false`** (§20/§21) — not a defect exactly (the flag was
   explicitly passed), but worth being deliberate about: the real runs
   should omit `--limit` entirely.
3. **No run-directory overwrite guard** (§16) — a theoretical same-second
   collision is not practically reachable given the proposed execution
   order, but the runner does not defensively check for an existing
   directory before writing.
4. Cost estimates in §12-15 are sizing aids derived from a single earlier
   smoke-test observation per provider, not a statistical sample — actual
   spend could differ from either figure.

No results analysis, provider ranking, expected winner, expected accuracy,
or expected best threshold is included anywhere in this report, per your
instruction.

## Exact approval statement needed before Phase 8B

To proceed to Phase 8B (the actual live 100-case `JEV_ONLY` run, followed
by the actual live 100-case `CLAUDE_ONLY` run), I need your explicit
approval covering:

1. How to resolve the credential-loading gap in §23.1 (shell export /
   `--env-file` / a small approved code change) — Phase 8B cannot make a
   live call until this is resolved one way or another.
2. Explicit authorization to run exactly the two commands in §20 (JEV_ONLY
   then CLAUDE_ONLY, full 100 cases each, no `--limit`), for a total of up
   to 200 live provider requests, at the rough/upper-bound costs in
   §14-15, with the failure policy in §10 (no manual retries, no
   replacing failed rows), executed sequentially and in the order in §8.

**STOP — waiting for approval. No live provider request, benchmark run, or
Phase 8B action has been taken.**
