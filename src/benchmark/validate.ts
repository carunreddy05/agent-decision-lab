import { ACTIONS } from "@/domain/action";
import { ROUTES } from "@/domain/route";
import type { BenchmarkCase, BenchmarkDataset, BenchmarkDifficulty } from "./types";

const DIFFICULTIES: readonly BenchmarkDifficulty[] = ["CLEAR", "MODERATE", "AMBIGUOUS"];
const POLICY_RESULTS = ["ALLOW", "REQUIRE_REVIEW", "DENY"] as const;

export interface ValidationIssue {
  caseId: string;
  message: string;
}

/**
 * Structural + cross-field validation for a benchmark dataset. Deliberately
 * does not re-derive or second-guess the labels themselves (that's a human
 * review job) — only checks that the dataset is internally well-formed and
 * that action/policy annotations are self-consistent.
 */
export function validateDataset(dataset: BenchmarkDataset): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();

  for (const benchCase of dataset.cases) {
    issues.push(...validateCase(benchCase, seenIds));
    seenIds.add(benchCase.id);
  }

  return issues;
}

function validateCase(benchCase: BenchmarkCase, seenIds: ReadonlySet<string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const id = benchCase.id || "<missing id>";

  if (!benchCase.id) {
    issues.push({ caseId: id, message: "missing id" });
  } else if (seenIds.has(benchCase.id)) {
    issues.push({ caseId: id, message: "duplicate id" });
  }

  if (!benchCase.prompt || !benchCase.prompt.trim()) {
    issues.push({ caseId: id, message: "empty prompt" });
  }

  if (!(ROUTES as readonly string[]).includes(benchCase.expectedRoute)) {
    issues.push({ caseId: id, message: `invalid expectedRoute: ${String(benchCase.expectedRoute)}` });
  }

  if (!DIFFICULTIES.includes(benchCase.difficulty)) {
    issues.push({ caseId: id, message: `invalid difficulty: ${String(benchCase.difficulty)}` });
  }

  if (!benchCase.category || !benchCase.category.trim()) {
    issues.push({ caseId: id, message: "missing category" });
  }

  if (
    benchCase.expectedAction !== undefined &&
    !(ACTIONS as readonly string[]).includes(benchCase.expectedAction)
  ) {
    issues.push({ caseId: id, message: `invalid expectedAction: ${String(benchCase.expectedAction)}` });
  }

  if (
    benchCase.expectedPolicy !== undefined &&
    !(POLICY_RESULTS as readonly string[]).includes(benchCase.expectedPolicy)
  ) {
    issues.push({ caseId: id, message: `invalid expectedPolicy: ${String(benchCase.expectedPolicy)}` });
  }

  issues.push(...validatePolicyConsistency(benchCase));

  return issues;
}

/**
 * Cross-field rules that hold regardless of how a given case was labeled:
 * every DELETE_DATABASE case must be DENY, every CREATE_JIRA case must be
 * REQUIRE_REVIEW, and the read-only actions must be ALLOW. These mirror
 * POLICY_RULES exactly on purpose — ground truth for policy is not a
 * judgment call, it's a lookup.
 */
function validatePolicyConsistency(benchCase: BenchmarkCase): ValidationIssue[] {
  const { expectedAction, expectedPolicy } = benchCase;
  if (expectedAction === undefined || expectedPolicy === undefined) {
    return [];
  }

  const id = benchCase.id || "<missing id>";
  const expectedForAction: Record<string, (typeof POLICY_RESULTS)[number]> = {
    READ_DOCS: "ALLOW",
    SEARCH_GITHUB_PR: "ALLOW",
    READ_GITHUB_PR: "ALLOW",
    SEARCH_JIRA: "ALLOW",
    READ_JIRA: "ALLOW",
    CREATE_JIRA: "REQUIRE_REVIEW",
    DELETE_DATABASE: "DENY",
  };

  const expected = expectedForAction[expectedAction];
  if (expected && expected !== expectedPolicy) {
    return [
      {
        caseId: id,
        message: `expectedPolicy ${expectedPolicy} inconsistent with expectedAction ${expectedAction} (expected ${expected})`,
      },
    ];
  }

  return [];
}
