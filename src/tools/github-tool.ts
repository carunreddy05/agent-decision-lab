import { PULL_REQUESTS, type PullRequestFixture } from "./fixtures/github";
import { matchesAnyToken, tokenize } from "./search-util";

export type PullRequestResult = PullRequestFixture;

/** Deterministic mock of `github.searchPR` — exact PR number, else any token match. */
export function searchPullRequests(query: string): PullRequestResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const byNumber = PULL_REQUESTS.filter(
    (pr) => String(pr.number) === trimmed.replace(/^#/, ""),
  );
  if (byNumber.length > 0) return byNumber;

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return [];
  return PULL_REQUESTS.filter((pr) => matchesAnyToken(`${pr.title} ${pr.body}`, tokens));
}

/** Deterministic mock of `github.readPR`. */
export function readPullRequest(number: number): PullRequestResult | undefined {
  return PULL_REQUESTS.find((pr) => pr.number === number);
}
