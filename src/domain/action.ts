/**
 * Actions the system can be asked to perform after a routing decision.
 * This is a distinct type from `RoutingDecision` on purpose: the policy
 * engine only ever sees an `Action`, never a route, confidence, or model
 * name, so authorization cannot be influenced by how sure a model was.
 */
export type Action =
  | "READ_DOCS"
  | "SEARCH_GITHUB_PR"
  | "READ_GITHUB_PR"
  | "SEARCH_JIRA"
  | "READ_JIRA"
  | "CREATE_JIRA"
  | "DELETE_DATABASE";

export const ACTIONS: readonly Action[] = [
  "READ_DOCS",
  "SEARCH_GITHUB_PR",
  "READ_GITHUB_PR",
  "SEARCH_JIRA",
  "READ_JIRA",
  "CREATE_JIRA",
  "DELETE_DATABASE",
];
