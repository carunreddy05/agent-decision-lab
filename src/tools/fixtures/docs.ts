export interface DocFixture {
  id: string;
  title: string;
  body: string;
}

/** Entirely fictional documentation set — see ADR-006. */
export const DOCS: DocFixture[] = [
  {
    id: "doc-retry-strategy",
    title: "Retry Strategy",
    body: "Guidance on exponential backoff and retry handling for requests that occasionally time out, including checkout flows.",
  },
  {
    id: "doc-k8s-deployment",
    title: "Kubernetes Deployment Guide",
    body: "How to deploy a service, roll back a release, and check deployment status visibility.",
  },
  {
    id: "doc-incident-response",
    title: "Incident Response Guide",
    body: "Runbook for responding to production incidents, including escalation and alerting thresholds.",
  },
  {
    id: "doc-auth-overview",
    title: "Authentication Overview",
    body: "How login and session tokens work, and what happens when a session expires unexpectedly.",
  },
  {
    id: "doc-onboarding",
    title: "Onboarding Guide",
    body: "Getting started with the repository, local setup, and where to find the mock tool fixtures.",
  },
  {
    id: "doc-monitoring-alerting",
    title: "Monitoring and Alerting Guide",
    body: "Dashboards, alert thresholds, and how to tune noisy alerts.",
  },
];
