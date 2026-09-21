import type { Action } from "./action";

export type PolicyResult = "ALLOW" | "REQUIRE_REVIEW" | "DENY";

export interface PolicyDecision {
  action: Action;
  result: PolicyResult;
  reason: string;
}
