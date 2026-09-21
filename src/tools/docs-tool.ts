import { DOCS, type DocFixture } from "./fixtures/docs";
import { matchesAnyToken, tokenize } from "./search-util";

export type DocResult = DocFixture;

/** Deterministic mock of `docs.search` — matches any meaningful query token. */
export function searchDocs(query: string): DocResult[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  return DOCS.filter((doc) => matchesAnyToken(`${doc.title} ${doc.body}`, tokens));
}
