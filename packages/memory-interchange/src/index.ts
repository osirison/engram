// Canonical markdown-interchange contract shared by ENGRAM export (WP3) and
// import (WP4). Keep this package dependency-light (zod + yaml only): it must
// NOT pull in Prisma / NestJS / ENGRAM metadata shapes (WP3 PLAN §8 risk 8).

export { MEMORY_INTERCHANGE_VERSION } from './version.js';

export {
  EDGE_TYPES,
  EDGE_INVERSE,
  EDGE_ORIGINS,
  edgeSchema,
  type EdgeType,
  type EdgeOrigin,
  type MemoryEdge,
} from './edge-types.js';

export {
  frontmatterSchema,
  provenanceSchema,
  memoryTypeSchema,
  type Frontmatter,
  type Provenance,
  type MemoryTierType,
} from './frontmatter.schema.js';

export { slugify, buildFilename, firstNonEmptyLine, SLUG_MAX_LENGTH } from './slug.js';

export {
  emitWikilink,
  emitWikilinkToken,
  parseWikilinks,
  escapeWikilinkBrackets,
  unescapeWikilinkBrackets,
  type ParsedWikilink,
} from './wikilink.js';
