import { JIRA_TICKETS, type JiraTicketFixture } from "./fixtures/jira";

export type JiraTicket = JiraTicketFixture;

/** Deterministic mock of `jira.searchTickets`. */
export function searchTickets(query: string): JiraTicket[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return JIRA_TICKETS.filter(
    (ticket) =>
      ticket.id.toLowerCase() === q ||
      ticket.title.toLowerCase().includes(q) ||
      ticket.body.toLowerCase().includes(q),
  );
}

/** Deterministic mock of `jira.readTicket`. */
export function readTicket(id: string): JiraTicket | undefined {
  return JIRA_TICKETS.find((ticket) => ticket.id.toLowerCase() === id.toLowerCase());
}

export interface CreateTicketInput {
  title: string;
  body: string;
}

/**
 * Deterministic mock of `jira.createTicket`. The id is derived purely from
 * the input (no shared counter state), so this is REQUIRE_REVIEW-gated in
 * policy but still trivially testable as a pure function.
 */
export function createTicket(input: CreateTicketInput): JiraTicket {
  return {
    id: `NEW-${hashString(input.title + input.body)}`,
    title: input.title,
    body: input.body,
    status: "Open",
  };
}

function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
