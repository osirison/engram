/**
 * Deterministic slug + filename helpers (WP3 PLAN §4.5).
 *
 * Filenames are `<slug>--<id>.md`. Because the full cuid2 `id` is appended and
 * cuid2 is collision-free, filenames are globally unique regardless of slug
 * collisions — the slug is purely cosmetic (human-browsable), so `slugify` may
 * be lossy without breaking anything. `slugify` is a pure function of content.
 */

/** First non-empty (trimmed) line of `content`, or `''` if none. */
export function firstNonEmptyLine(content: string): string {
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length > 0) return line;
  }
  return '';
}

/** Maximum slug length before the `--<id>` suffix is appended. */
export const SLUG_MAX_LENGTH = 60;

// Unicode combining diacritical marks (U+0300–U+036F); stripped after NFKD so
// accented letters transliterate to their ASCII base (é → e, ü → u).
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Lowercase, ASCII-transliterated, hyphen-separated slug of the first non-empty
 * line of `content`. Diacritics are stripped; any remaining non-`[a-z0-9]` run
 * collapses to a single `-`. Empty result → `"memory"`.
 */
export function slugify(content: string): string {
  const line = firstNonEmptyLine(content);
  const ascii = line.normalize('NFKD').replace(COMBINING_MARKS, '');
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumeric runs → single hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, ''); // re-trim a hyphen left dangling by truncation
  return slug.length > 0 ? slug : 'memory';
}

/**
 * `<slug>--<id>.md`. The `id` is the globally-unique cuid2, so the returned
 * filename is unique even when two memories slugify identically.
 */
export function buildFilename(id: string, content: string): string {
  return `${slugify(content)}--${id}.md`;
}
