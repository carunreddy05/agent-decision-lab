# ADR-005: The Mock Provider Is Never Counted in Benchmark Results

## Status

Accepted (Phase 1–2). Referenced in `src/domain/trace.ts`,
`src/providers/mock/mock-provider.ts`.

## Context

`MockRouterProvider` (a deterministic keyword heuristic) was built in
Phase 1–2 to develop and test the rest of the pipeline — Hybrid
escalation, policy, tracing, the UI — before any real provider existed,
and to give the automated test suite a network-free, zero-cost
`RouterProvider` to exercise. It is also still the default provider
behind the interactive UI's mock mode. Its accuracy against the frozen
benchmark dataset (49/100, per `scripts/phase3-baseline.ts`) is a
reasonable heuristic, but it is not a model, and treating it as one in
any real-provider comparison would misrepresent both the experiment and
the mock's actual purpose.

## Decision

`Strategy` (`src/domain/trace.ts`) includes `"MOCK"` alongside
`"JEV_ONLY"`, `"CLAUDE_ONLY"`, and `"HYBRID"`, but it is explicitly
documented as a development strategy, never used to produce reported
benchmark numbers. The benchmark CLI (`scripts/benchmark-runner.ts`,
`src/benchmark/cli.ts`) does not even accept `mock` as a valid
`--strategy` value — the only way to run it is
`scripts/phase3-baseline.ts`, a separate, clearly-labeled script whose
own output is headed "NOT a Jev/Claude benchmark."

## Consequences

- Every benchmark report in this repository (`benchmark/reports/`)
  compares only real providers (Jev, Claude, and the offline Hybrid
  reconstruction of both) — the mock heuristic never appears as a
  comparison point.
- The mock provider remains fully supported and tested (it is what the
  automated test suite and the UI's default mode use), so removing it
  was never on the table — only ever excluded from being *counted* as
  benchmark evidence.
