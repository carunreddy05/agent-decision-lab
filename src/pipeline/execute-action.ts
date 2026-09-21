import type { Action } from "@/domain/action";
import type { ExecutionResult } from "@/domain/trace";
import { searchDocs } from "@/tools/docs-tool";
import { readPullRequest, searchPullRequests } from "@/tools/github-tool";
import { readTicket, searchTickets } from "@/tools/jira-tool";
import type { DerivedAction } from "./derive-action";

export const TOOL_NAMES: Record<Action, string> = {
  READ_DOCS: "docs.search",
  SEARCH_GITHUB_PR: "github.searchPR",
  READ_GITHUB_PR: "github.readPR",
  SEARCH_JIRA: "jira.searchTickets",
  READ_JIRA: "jira.readTicket",
  CREATE_JIRA: "jira.createTicket",
  DELETE_DATABASE: "database.delete",
};

/**
 * Runs the mock tool for an action policy has ALLOWed. The orchestrator
 * (run-decision.ts) only calls this after checking `evaluatePolicy(action)
 * === "ALLOW"` — this function does not re-check policy itself. CREATE_JIRA
 * and DELETE_DATABASE are never ALLOWed by the current policy rules, so
 * their branches below are a defensive fallback, not an expected path.
 */
export function executeAllowedAction(derived: DerivedAction): ExecutionResult {
  const action = derived.action;
  if (!action) {
    return { tool: "none", status: "error", detail: "No action to execute." };
  }
  const tool = TOOL_NAMES[action];

  switch (action) {
    case "READ_DOCS": {
      const results = searchDocs(derived.params.query ?? "");
      return {
        tool,
        status: "success",
        detail: results.length ? `${results.length} doc(s) found.` : "No matching docs found.",
        results: results.map((doc) => ({ id: doc.id, title: doc.title, body: doc.body })),
      };
    }

    case "SEARCH_GITHUB_PR": {
      const results = searchPullRequests(derived.params.query ?? "");
      return {
        tool,
        status: "success",
        detail: results.length
          ? `${results.length} pull request(s) found.`
          : "No matching pull requests found.",
        results: results.map((pr) => ({ number: pr.number, title: pr.title, status: pr.status })),
      };
    }

    case "READ_GITHUB_PR": {
      const pr = readPullRequest(Number(derived.params.prNumber));
      if (!pr) {
        return {
          tool,
          status: "error",
          detail: `No pull request found for #${derived.params.prNumber}.`,
        };
      }
      return {
        tool,
        status: "success",
        detail: `PR #${pr.number} found.`,
        results: [{ number: pr.number, title: pr.title, status: pr.status, body: pr.body }],
      };
    }

    case "SEARCH_JIRA": {
      const results = searchTickets(derived.params.query ?? "");
      return {
        tool,
        status: "success",
        detail: results.length ? `${results.length} ticket(s) found.` : "No matching tickets found.",
        results: results.map((ticket) => ({
          id: ticket.id,
          title: ticket.title,
          status: ticket.status,
        })),
      };
    }

    case "READ_JIRA": {
      const ticket = readTicket(derived.params.ticketId ?? "");
      if (!ticket) {
        return { tool, status: "error", detail: `No ticket found for ${derived.params.ticketId}.` };
      }
      return {
        tool,
        status: "success",
        detail: `${ticket.id} found.`,
        results: [
          { id: ticket.id, title: ticket.title, status: ticket.status, body: ticket.body },
        ],
      };
    }

    case "CREATE_JIRA":
    case "DELETE_DATABASE":
      return {
        tool,
        status: "error",
        detail: "Policy violation: this action must never reach automatic execution.",
      };

    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
