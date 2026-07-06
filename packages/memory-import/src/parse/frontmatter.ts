// Tolerant YAML frontmatter splitter shared by every adapter (WP4 PLAN §T1
// step 4). Unlike `@engram/memory-interchange`'s `parseDocument` (which REQUIRES
// a valid canonical frontmatter block), source files in the wild may have no
// frontmatter, an empty block, or non-canonical keys — all tolerated here.

import { parse as yamlParse } from 'yaml';

export interface SplitFrontmatter {
  /** Parsed mapping, or `undefined` when absent/empty/not-a-mapping/invalid. */
  frontmatter?: Record<string, unknown>;
  /** Everything after the closing fence (or the whole input when no fence). */
  body: string;
}

// A leading `---\n <yaml> \n---` fence. Non-greedy body so a `---` later in the
// document (e.g. an MDC separator or thematic break) can't be mistaken for the
// close. The pre-close `\n` is optional so an EMPTY block (`---\n---\n`) — where
// the opening fence's newline is the only one — still matches. Tolerates a
// trailing `--- ` space and CRLF (normalized first).
const FRONTMATTER_RE = /^---[ \t]*\n([\s\S]*?)\n?---[ \t]*(?:\n|$)/;

/**
 * Split `raw` into `{ frontmatter, body }`. Missing, empty, malformed, or
 * scalar/array frontmatter all yield `frontmatter: undefined` without throwing;
 * the body is returned with `\n` line endings.
 */
export function splitFrontmatter(raw: string): SplitFrontmatter {
  const normalized = raw.replace(/\r\n?/g, '\n');
  const match = FRONTMATTER_RE.exec(normalized);
  if (!match) {
    return { body: normalized };
  }

  const yamlText = (match[1] ?? '').trim();
  const body = normalized.slice(match[0].length);
  if (yamlText.length === 0) {
    return { body };
  }

  let parsed: unknown;
  try {
    parsed = yamlParse(yamlText);
  } catch {
    // Invalid YAML inside a fence: keep the original content intact rather than
    // silently dropping it — treat the whole input as body, no frontmatter.
    return { body: normalized };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { body };
  }
  return { frontmatter: parsed as Record<string, unknown>, body };
}
