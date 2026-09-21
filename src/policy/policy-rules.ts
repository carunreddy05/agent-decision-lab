import type { Action } from "@/domain/action";
import type { PolicyResult } from "@/domain/policy";

interface PolicyRule {
  result: PolicyResult;
  reason: string;
}

/**
 * The single source of truth for what this system is allowed to do.
 * Deliberately a flat, readable table keyed by Action — no model, no
 * confidence, no request context. Adding an action here is the only way
 * to change what policy permits; nothing upstream can override it.
 */
export const POLICY_RULES: Record<Action, PolicyRule> = {
  READ_DOCS: { result: "ALLOW", reason: "read-only, no external side effects" },
  SEARCH_GITHUB_PR: { result: "ALLOW", reason: "read-only, no external side effects" },
  READ_GITHUB_PR: { result: "ALLOW", reason: "read-only, no external side effects" },
  SEARCH_JIRA: { result: "ALLOW", reason: "read-only, no external side effects" },
  READ_JIRA: { result: "ALLOW", reason: "read-only, no external side effects" },
  CREATE_JIRA: {
    result: "REQUIRE_REVIEW",
    reason: "creates a new record in an external system; needs human confirmation",
  },
  DELETE_DATABASE: {
    result: "DENY",
    reason: "destructive action; never permitted regardless of model confidence",
  },
};
