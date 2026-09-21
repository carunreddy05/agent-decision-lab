export interface JiraTicketFixture {
  id: string;
  title: string;
  body: string;
  status: "Open" | "In Progress" | "Done";
}

/** Entirely fictional ticket set — see ADR-006. */
export const JIRA_TICKETS: JiraTicketFixture[] = [
  {
    id: "ENG-142",
    title: "Checkout request occasionally times out",
    body: "Checkout intermittently fails with a timeout under load. See PR #431 for the retry fix.",
    status: "Done",
  },
  {
    id: "ENG-207",
    title: "Improve deployment status visibility",
    body: "No easy way to see rollout status today. See PR #515.",
    status: "Done",
  },
  {
    id: "ENG-118",
    title: "Users get logged out unexpectedly",
    body: "Sessions expire earlier than the configured duration. See PR #402.",
    status: "Done",
  },
  {
    id: "ENG-256",
    title: "Add more integration test coverage for checkout",
    body: "Checkout retry path is not covered end to end. See PR #388.",
    status: "In Progress",
  },
  {
    id: "ENG-301",
    title: "Alerting thresholds too noisy",
    body: "On-call is getting paged too often for non-actionable alerts. See PR #470.",
    status: "In Progress",
  },
];
