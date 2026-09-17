// Name matching for `/v1/search` and the `q` filter: case and diacritic insensitive (prd FR-30).

const MARKS = /\p{M}+/gu;
const SEPARATORS = /[^\p{L}\p{N}]+/gu;

/** `Castellan’s Créed` → `castellan s creed`. */
export function normalizeText(text: string): string {
  return text.normalize("NFKD").replace(MARKS, "").toLowerCase().replace(SEPARATORS, " ").trim();
}

export interface TextQuery {
  normalized: string; // `ar 23`
  compact: string; // `ar23`, so `ar23` still finds `AR-23 Liberator`
}

export const MIN_QUERY_LENGTH = 2;

/** Null when fewer than two letters or digits remain. */
export function textQuery(q: string): TextQuery | null {
  const normalized = normalizeText(q);
  const compact = normalized.replaceAll(" ", "");
  return compact.length >= MIN_QUERY_LENGTH ? { normalized, compact } : null;
}

/**
 * Best rank over the normalized terms (name and aliases), lower is better: 0 exact,
 * 1 prefix, 2 word prefix, 3 substring, 4 substring ignoring spaces; null = no match.
 */
export function matchScore(terms: readonly string[], query: TextQuery): number | null {
  let best: number | null = null;
  for (const term of terms) {
    let score: number | null = null;
    if (term === query.normalized) score = 0;
    else if (term.startsWith(query.normalized)) score = 1;
    else if (` ${term}`.includes(` ${query.normalized}`)) score = 2;
    else if (term.includes(query.normalized)) score = 3;
    else if (term.replaceAll(" ", "").includes(query.compact)) score = 4;
    if (score !== null && (best === null || score < best)) best = score;
  }
  return best;
}

/** Normalized, de-duplicated search terms of an entity. */
export function searchTerms(name: string, aliases: readonly string[]): string[] {
  return [...new Set([name, ...aliases].map(normalizeText).filter((term) => term.length > 0))];
}
