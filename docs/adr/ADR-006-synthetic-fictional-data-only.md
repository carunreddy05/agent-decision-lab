# ADR-006: All Tool Data, Fixtures, and Benchmark Cases Are Synthetic and Fictional

## Status

Accepted (Phase 1, extended Phase 3). Referenced in
`src/tools/fixtures/{docs,github,jira}.ts`, `src/benchmark/types.ts`.

## Context

This project is a personal, public-facing engineering experiment about
AI decision-routing architecture — not a showcase of any real
organization's tools, tickets, codebase, or documentation. Any real
company data, even lightly anonymized, would risk exposing information
that shouldn't be public and would tie a general architecture question to
a specific employer or product in a way this project is explicitly not
about.

## Decision

- `src/tools/fixtures/{docs.ts, github.ts, jira.ts}` are entirely
  fictional datasets — invented documentation pages, invented pull
  requests, invented tickets. None reference any real system, repository,
  or organization.
- `benchmark/datasets/routing-v1.0.json`'s 100 cases are hand-authored,
  synthetic prompts designed to exercise the five routes
  (`DIRECT_ANSWER`/`DOCS`/`GITHUB`/`JIRA`/`REJECT`) across a range of
  difficulty levels and categories — not drawn from, or based on, real
  user requests or real support tickets.
- Mock tool execution (`src/tools/`) simulates responses over these fixed
  fictional fixtures; it never calls a real docs site, a real GitHub API,
  or a real Jira instance.

## Consequences

- The entire benchmark — dataset, ground truth, tool responses — can be
  published and reproduced by anyone without exposing anything private.
- This also means the benchmark's results say nothing about performance
  on *real* production traffic, real ticket phrasing, or a real
  document corpus — a limitation stated explicitly throughout
  `benchmark/reports/` and `src/benchmark/limitations.ts`, not something
  this ADR papers over.
