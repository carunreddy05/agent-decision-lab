import { describe, expect, it } from "vitest";
import { searchDocs } from "@/tools/docs-tool";

describe("searchDocs", () => {
  it("matches by title, case-insensitively", () => {
    const results = searchDocs("RETRY strategy");
    expect(results.some((doc) => doc.id === "doc-retry-strategy")).toBe(true);
  });

  it("matches by body content", () => {
    const results = searchDocs("session expire");
    expect(results.some((doc) => doc.id === "doc-auth-overview")).toBe(true);
  });

  it("returns an empty array for an empty query", () => {
    expect(searchDocs("   ")).toEqual([]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(searchDocs("nonexistent-topic-xyz")).toEqual([]);
  });
});
