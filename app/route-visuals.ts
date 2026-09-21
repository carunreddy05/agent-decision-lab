import type { Route } from "@/domain/route";

/**
 * Route -> display label/color, fixed by identity (never reassigned by
 * probability rank). Colors are the validated categorical palette slots,
 * assigned in the Route taxonomy's own order — see globals.css.
 */
export const ROUTE_LABELS: Record<Route, string> = {
  DIRECT_ANSWER: "Direct Answer",
  DOCS: "Docs",
  GITHUB: "GitHub",
  JIRA: "Jira",
  REJECT: "Reject",
};

export const ROUTE_COLOR_VAR: Record<Route, string> = {
  DIRECT_ANSWER: "var(--route-direct-answer)",
  DOCS: "var(--route-docs)",
  GITHUB: "var(--route-github)",
  JIRA: "var(--route-jira)",
  REJECT: "var(--route-reject)",
};
