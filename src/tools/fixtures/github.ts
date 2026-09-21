export interface PullRequestFixture {
  number: number;
  title: string;
  body: string;
  status: "open" | "merged" | "closed";
}

/** Entirely fictional PR set — see ADR-006. */
export const PULL_REQUESTS: PullRequestFixture[] = [
  {
    number: 431,
    title: "Add timeout retry handling",
    body: "Implements exponential backoff for checkout requests that occasionally time out. Related to ENG-142.",
    status: "merged",
  },
  {
    number: 515,
    title: "Expose deployment status",
    body: "Adds a deployment status endpoint for visibility into rollouts. Related to ENG-207.",
    status: "merged",
  },
  {
    number: 402,
    title: "Fix login session expiry bug",
    body: "Sessions were expiring earlier than configured. Related to ENG-118.",
    status: "merged",
  },
  {
    number: 388,
    title: "Add integration tests for checkout flow",
    body: "Covers the checkout retry path end to end. Related to ENG-256.",
    status: "open",
  },
  {
    number: 470,
    title: "Refactor alerting thresholds config",
    body: "Makes alert thresholds configurable per service to reduce noise. Related to ENG-301.",
    status: "open",
  },
];
