/**
 * Version of the canonical markdown-interchange contract (frontmatter shape +
 * typed edge vocabulary). Stamped into every exported document's frontmatter as
 * `schemaVersion`, and asserted by the WP4 importer so the two sides cannot
 * drift silently (see WP3 PLAN §4.1 / gap G6).
 *
 * Bump only on a breaking change to the frontmatter/edge contract.
 */
export const MEMORY_INTERCHANGE_VERSION = '1.0';
