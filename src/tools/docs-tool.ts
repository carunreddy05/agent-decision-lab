import { DOCS, type DocFixture } from "./fixtures/docs";

export type DocResult = DocFixture;

/** Deterministic mock of `docs.search` — case-insensitive substring match. */
export function searchDocs(query: string): DocResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return DOCS.filter(
    (doc) => doc.title.toLowerCase().includes(q) || doc.body.toLowerCase().includes(q),
  );
}
