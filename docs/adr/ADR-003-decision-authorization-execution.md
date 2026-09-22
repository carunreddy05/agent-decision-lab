# ADR-003: Decision, Authorization, and Execution Are Separate Boundaries

## Status

Accepted (Phase 1). Referenced throughout the codebase — see
`src/policy/policy-engine.ts`, `src/pipeline/derive-action.ts`.

## Context

An AI-routed agent pipeline could easily let a model's output flow
directly into a tool call: the model picks a destination, the model (or a
thin wrapper around it) decides what to do there, and the action runs. If
confidence or reasoning quality is ever allowed to influence whether an
action is *permitted*, the system's safety property collapses into "trust
the model enough." This project's second architectural question — where
should probabilistic decision-making end and deterministic control begin
— requires a hard, structural answer, not a convention that's easy to
erode under deadline pressure.

## Decision

Three concerns are kept as strictly separate steps, each with its own
type and its own function boundary:

1. **Decision** — a `RouterProvider` (Jev, Claude, or the Hybrid
   composition of both) returns a `RoutingDecision`: a `Route` plus
   optional confidence/probabilities. Providers never see anything past
   this point.
2. **Authorization** — `evaluatePolicy(action: Action): PolicyDecision`
   (`src/policy/policy-engine.ts`) takes **only** an `Action`. Its
   signature makes it structurally impossible to pass in a confidence
   score, a model name, or "but the model was really sure" — there is no
   parameter for any of that.
3. **Execution** — a mock tool (`src/tools/`) runs only after policy
   returns `ALLOW`. A `REQUIRE_REVIEW` or `DENY` result never reaches a
   tool.

A route (`Route`, e.g. `JIRA`) and an action (`Action`, e.g.
`CREATE_JIRA`) are also kept as distinct domain types on purpose — a
destination alone can't safely imply what operation is being requested
there. `deriveAction()` (`src/pipeline/derive-action.ts`) maps route +
prompt to an action, and runs a destructive-intent check *independently
of, and before*, the route-based mapping, so a dangerous request reaches
policy (and is denied) even if the router itself misclassified or
rejected the request.

## Consequences

- `evaluatePolicy`'s table (`src/policy/policy-rules.ts`) is the single
  source of truth for what the system may do — adding a new permission
  requires editing that table, nothing upstream can override it.
- A `DELETE_DATABASE` action is `DENY` unconditionally, regardless of
  which provider proposed it or how confident that provider reported
  being. This was verified empirically, not just by design: across the
  full Phase 8 benchmark, the highest-confidence Jev decision observed
  (0.99, on RC-048) carried the same zero authorization weight as any
  other.
- No destructive tool has ever been wired to a real adapter — `DENY`
  actions have nothing to accidentally execute later.
