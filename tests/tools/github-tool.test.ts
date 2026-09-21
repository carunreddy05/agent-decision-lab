import { describe, expect, it } from "vitest";
import { readPullRequest, searchPullRequests } from "@/tools/github-tool";

describe("searchPullRequests", () => {
  it("matches by title/body content", () => {
    const results = searchPullRequests("timeout");
    expect(results.some((pr) => pr.number === 431)).toBe(true);
  });

  it("matches by PR number, with or without a leading #", () => {
    expect(searchPullRequests("431").some((pr) => pr.number === 431)).toBe(true);
    expect(searchPullRequests("#431").some((pr) => pr.number === 431)).toBe(true);
  });

  it("returns an empty array for an empty query", () => {
    expect(searchPullRequests("")).toEqual([]);
  });
});

describe("readPullRequest", () => {
  it("returns the matching PR", () => {
    expect(readPullRequest(431)?.title).toBe("Add timeout retry handling");
  });

  it("returns undefined for an unknown PR number", () => {
    expect(readPullRequest(999999)).toBeUndefined();
  });
});
