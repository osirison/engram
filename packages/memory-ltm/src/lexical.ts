/**
 * Query tokenisation and term-overlap scoring for the lexical fallback path.
 *
 * These are deliberately small and dependency-free so they can be reasoned
 * about (and tested) without a database. The scoring they produce feeds the
 * `similarity` slot of {@link ./rank.rankResults}, so it must stay in [0, 1] to
 * keep blended scores comparable in shape to the semantic path.
 */

/** Terms shorter than this carry no retrieval signal and are dropped. */
const MIN_TERM_LENGTH = 2;

/**
 * Upper bound on distinct terms used for matching.
 *
 * Each term becomes one `OR` branch in the SQL `WHERE`, so an unbounded query
 * would let a caller build an arbitrarily large statement. Long queries keep
 * their most distinctive terms — the first ones — and the rest are ignored.
 */
const MAX_TERMS = 24;

/**
 * Very common English words carry no discriminating signal but match almost
 * every row, so they would flatten the score and blow past the over-fetch
 * window on natural-language queries such as "which package manager do we use".
 *
 * This list is intentionally short. It removes the words that would otherwise
 * match everything, and stops well short of being a linguistic stopword list —
 * over-trimming would drop terms that genuinely discriminate in a technical
 * corpus.
 */
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'do',
  'does',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'our',
  'that',
  'the',
  'this',
  'to',
  'we',
  'what',
  'when',
  'which',
  'who',
  'why',
  'with',
  'you',
  'your',
]);

/**
 * Split a natural-language query into distinct, lowercased match terms.
 *
 * Splitting on non-alphanumerics keeps version-ish and identifier-ish tokens
 * usable (`pnpm`, `11`, `postgres`) while discarding punctuation. Order is
 * preserved and duplicates removed, so the returned length is the denominator
 * {@link lexicalRelevance} scores against.
 *
 * If every token is a stop word the stop list is ignored rather than returning
 * nothing: a query like "how do we do this" should still attempt a match rather
 * than silently retrieve nothing.
 */
export function tokenizeQuery(query: string | null | undefined): string[] {
  if (typeof query !== 'string') return [];
  const raw = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= MIN_TERM_LENGTH);
  if (raw.length === 0) return [];

  const distinct = [...new Set(raw)];
  const meaningful = distinct.filter((term) => !STOP_WORDS.has(term));
  // Fall back to the unfiltered set when a query is nothing but stop words.
  const chosen = meaningful.length > 0 ? meaningful : distinct;
  return chosen.slice(0, MAX_TERMS);
}

/**
 * Fraction of `terms` that appear anywhere in `content`, in [0, 1].
 *
 * Substring matching (not word-boundary matching) mirrors the SQL `ILIKE
 * %term%` used to select the candidates, so the score cannot claim a match the
 * query did not actually make — or miss one it did. Repeats do not increase the
 * score: this measures coverage of the query, not term frequency.
 *
 * Returns 0 for an empty term list so a caller cannot manufacture a perfect
 * score from an empty query.
 */
export function lexicalRelevance(
  content: string | null | undefined,
  terms: readonly string[]
): number {
  if (terms.length === 0) return 0;
  if (typeof content !== 'string' || content.length === 0) return 0;
  const haystack = content.toLowerCase();
  let matched = 0;
  for (const term of terms) {
    if (haystack.includes(term)) matched += 1;
  }
  return matched / terms.length;
}
