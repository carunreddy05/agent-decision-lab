const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "for",
  "to",
  "of",
  "in",
  "on",
  "and",
  "is",
  "are",
  "this",
  "that",
  "find",
  "show",
  "me",
  "please",
  "get",
  "what",
  "which",
  "associated",
  "with",
]);

/**
 * Splits free text into lowercased, meaningful search tokens. Shared by all
 * three mock tools so a natural-language prompt can be used as a search
 * query directly, the way a real search tool would handle it, rather than
 * requiring an exact substring match against short fixture titles.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

export function matchesAnyToken(haystack: string, tokens: string[]): boolean {
  const lower = haystack.toLowerCase();
  return tokens.some((token) => lower.includes(token));
}
