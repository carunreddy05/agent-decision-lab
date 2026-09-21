import type { Action } from "@/domain/action";
import type { Route } from "@/domain/route";

export interface DerivedAction {
  action: Action | null;
  reason: string;
  params: Record<string, string>;
}

const TICKET_ID_PATTERN = /\b([a-z]{2,10}-\d+)\b/i;
const PR_NUMBER_PATTERN = /#(\d+)|\bpr\s*(\d+)\b/i;
// Deliberately narrower than bare "create|open|file|log": "open" alone is too
// common in status language ("open tickets", "still open") to safely signal
// creation intent, so it only counts paired with "a/an ticket|issue|bug".
const CREATE_PATTERN = /\b(create|file|log)\b|\bopen an? (ticket|issue|bug)\b/i;

/**
 * Destructive-intent check that runs *before* (and independently of) the
 * route→action mapping below. This is deliberate: a route is only a content
 * classification ("which system"), not a safety signal, so a request whose
 * text clearly asks for a destructive operation is escalated to
 * DELETE_DATABASE regardless of what route the router chose — including
 * REJECT. The router's classification never gets the final say over whether
 * a dangerous action is proposed to policy; only policy decides whether it
 * runs, and it always denies this one. See ADR-003.
 */
const DESTRUCTIVE_PATTERN = /\b(delete|drop|destroy|wipe)\b[\s\S]*\b(database|db|production)\b/i;

/**
 * Maps a routing decision's route, plus the raw prompt text, to a concrete
 * Action. Route and Action are intentionally separate domain concepts
 * (Phase 1): a route says *where* a request belongs, an action says *what
 * operation* is being proposed within that domain — a route alone can't
 * distinguish "read ticket ENG-142" from "create a new ticket". This
 * heuristic mapping is a Phase 2 stand-in; a real router (Jev/Claude) may
 * eventually report action-level intent directly.
 */
export function deriveAction(route: Route, prompt: string): DerivedAction {
  if (DESTRUCTIVE_PATTERN.test(prompt)) {
    return {
      action: "DELETE_DATABASE",
      reason:
        "Destructive intent detected in the request text — evaluated by policy regardless of route.",
      params: {},
    };
  }

  switch (route) {
    case "DOCS":
      return { action: "READ_DOCS", reason: "DOCS route.", params: { query: prompt } };

    case "GITHUB": {
      const match = prompt.match(PR_NUMBER_PATTERN);
      const prNumber = match?.[1] ?? match?.[2];
      if (prNumber) {
        return {
          action: "READ_GITHUB_PR",
          reason: "A specific PR number was mentioned.",
          params: { prNumber },
        };
      }
      return {
        action: "SEARCH_GITHUB_PR",
        reason: "GITHUB route, no specific PR mentioned.",
        params: { query: prompt },
      };
    }

    case "JIRA": {
      if (CREATE_PATTERN.test(prompt)) {
        return {
          action: "CREATE_JIRA",
          reason: "Creation intent detected in the request text.",
          params: { title: summarize(prompt), body: prompt },
        };
      }
      const match = prompt.match(TICKET_ID_PATTERN);
      if (match) {
        return {
          action: "READ_JIRA",
          reason: "A specific ticket id was mentioned.",
          params: { ticketId: match[1] },
        };
      }
      return {
        action: "SEARCH_JIRA",
        reason: "JIRA route, no specific ticket mentioned.",
        params: { query: prompt },
      };
    }

    case "DIRECT_ANSWER":
      return {
        action: null,
        reason: "No external tool action needed for a direct answer.",
        params: {},
      };

    case "REJECT":
      return {
        action: null,
        reason: "Router rejected the request; no action proposed.",
        params: {},
      };
  }
}

function summarize(prompt: string): string {
  const trimmed = prompt.trim();
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
}
