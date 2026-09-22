# Public Benchmark Evidence

This directory contains selected, reviewed, machine-readable artifacts
from the experiments reported in Agent Decision Lab — published so an
external reader can independently verify the headline results without
needing to trust prose alone, and without needing live API access.

`benchmark/results/` (the full set of generated run artifacts) remains
gitignored, because it holds working outputs of every run made during
development, including ones excluded here as unnecessary for
auditability (a smoke test and a small pacing-validation run). This
directory is a small, deliberately-selected subset of that working
output, copied byte-for-byte (verified via `checksums.sha256`) — nothing
here was hand-edited.

## What's included, and why

| Directory | Source run | Live or offline | Supports |
|---|---|---|---|
| `jev-canonical/` | `20260922-174506-jev-only` | Live (paced, 2000ms) | Jev's 91/100 routing accuracy, latency, cost, confusion matrix |
| `claude-canonical/` | `20260922-165824-claude-only` | Live | Claude's 90/100 routing accuracy, latency, cost, confusion matrix |
| `hybrid-offline/` | `20260922-175924-hybrid` | **Offline reconstruction** — zero provider calls, reused the two runs above | All five confidence-threshold rows, RC-048/RC-049, provider relationship |
| `jev-rate-limit-incident/` | `20260922-165700-jev-only` | Live (unpaced) | The documented 70/100 HTTP 429 operational incident |

**`jev-rate-limit-incident/` demonstrates the operational rate-limit
incident only. It is NOT used as, and must not be read as, the Jev
model-quality baseline** — `jev-canonical/` is the baseline. The incident
run is included specifically so the "70 HTTP 429s" claim in the README
and reports can be checked against real per-case data, not just prose.

**Intentionally excluded:**
- The 10-case pacing validation (`20260922-173856-jev-only`) — an
  infrastructure check, not benchmark evidence, and not needed to
  reproduce any headline number.
- The earlier, incomplete offline Hybrid analysis
  (`20260922-170132-hybrid`, reconstructed from the original 30-success
  unpaced Jev run) — superseded by `hybrid-offline/`. Publishing both
  would let a reader compute two different sets of Hybrid numbers from
  two different Jev inputs and reasonably wonder which is canonical;
  excluding the superseded one removes that ambiguity. `hybrid-offline/`
  is the only Hybrid evidence published, and it is the one that matches
  every Hybrid number reported elsewhere in this repository.
- `summary.json`/`summary.md` from each run — fully derivable from the
  published `cases.jsonl` via the same scoring functions
  (`src/benchmark/metrics/`), so republishing them would be redundant,
  not independent evidence.

## What's NOT in these files

- **No raw prompt text.** Every case record carries only `promptHash` (a
  SHA-256 of the exact prompt), never the prompt itself. The prompt
  behind any `caseId` remains recoverable only from the separately
  tracked frozen dataset, `benchmark/datasets/routing-v1.0.json`.
- **No credentials, API keys, Authorization headers, or raw provider
  response bodies.** Verified directly, field-by-field, before
  publishing — not assumed.
- **No employer, customer, or otherwise private information.** These are
  routing decisions over the project's own synthetic, fictional dataset
  (see [ADR-006](../../docs/adr/ADR-006-synthetic-fictional-data-only.md)).

## Verifying these files

`checksums.sha256` records the SHA-256 of every file in this directory.
Every file was copied byte-for-byte from its source run in
`benchmark/results/` with **zero sanitization or hand-editing** — the
hashes exist so that claim is independently checkable, not just stated:

```bash
cd benchmark/public-results
shasum -a 256 -c checksums.sha256
```

To recompute the headline numbers (routing accuracy, provider
relationship, all five Hybrid threshold rows, the RC-048/RC-049 facts,
and the rate-limit incident's success/failure counts) directly from these
files, using the project's own existing scoring code — no API key, no
network access, no provider call:

```bash
npx tsx scripts/verify-public-results.ts
```

This script only reads the JSON/JSONL files in this directory and prints
aggregates; it does not call a provider, does not modify anything, and
introduces no new scoring logic — it reuses the same pure functions
(`src/benchmark/metrics/*`, `src/benchmark/threshold-simulation.ts`) the
real benchmark runner uses.

## Caveats

- Publishing these artifacts does not imply provider outputs are
  deterministic — a fresh live run today could produce different
  per-case decisions than the ones recorded here. These files are a
  record of specific runs made on specific dates, not a live or
  continuously-updated feed.
- Provider and model behavior, availability, and pricing may change over
  time; `pricingConfigVersion` and `requestedModelIdentifiers` in each
  `manifest.json` record exactly which assumptions produced these
  specific numbers.
- See [`../reports/experiment-evidence.md`](../reports/experiment-evidence.md)
  for the full, explicit list of what these results do and do not
  establish.
