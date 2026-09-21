import { PULL_REQUESTS, type PullRequestFixture } from "./fixtures/github";

export type PullRequestResult = PullRequestFixture;

/** Deterministic mock of `github.searchPR`. */
export function searchPullRequests(query: string): PullRequestResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return PULL_REQUESTS.filter(
    (pr) =>
      pr.title.toLowerCase().includes(q) ||
      pr.body.toLowerCase().includes(q) ||
      String(pr.number) === q.replace(/^#/, ""),
  );
}

/** Deterministic mock of `github.readPR`. */
export function readPullRequest(number: number): PullRequestResult | undefined {
  return PULL_REQUESTS.find((pr) => pr.number === number);
}
