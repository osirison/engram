// Public surface of @engram/memory-import (WP4). The agentic memory importer:
// source adapters → common IR → deduped, provenance-tracked long-term memories
// with preserved links. See docs/plans/2026-07-memory-platform/WP4-*.

// ── IR contract (T1) ────────────────────────────────────────────────────────
export type {
  SourceTool,
  MemoryLinkOrigin,
  LinkKind,
  ImportedLink,
  ImportedFact,
  ProvenanceCommon,
  ImportIR,
} from './ir/types.js';
export { SOURCE_TOOLS, MEMORY_LINK_ORIGINS } from './ir/types.js';
export type { SourceAdapter, ParseOptions } from './ir/source-adapter.interface.js';

// ── Shared parse utilities (T1) ─────────────────────────────────────────────
export { splitFrontmatter, type SplitFrontmatter } from './parse/frontmatter.js';
export {
  extractLinks,
  extractWikilinks,
  extractRelativeLinks,
  extractFrontmatterLinks,
  deriveFactLocators,
  wikilinkLocator,
  fileStemSlug,
} from './parse/links.js';
export {
  chunkByHeadings,
  shouldSplitAtomic,
  INGEST_CHUNK_CHAR_LIMIT,
  MIN_SECTION_CHARS,
  ATOMIC_SPLIT_THRESHOLD,
  type Section,
} from './parse/chunk.js';

// ── Content hash (T3 idempotency / drift) ───────────────────────────────────
export { computeContentHash } from './content-hash.js';

// ── Idempotency ledger (T2) ─────────────────────────────────────────────────
export {
  ImportLedgerService,
  type LedgerEntry,
  type UpsertLedgerInput,
} from './ledger/import-ledger.service.js';

// ── NestJS module ───────────────────────────────────────────────────────────
export { MemoryImportModule } from './memory-import.module.js';
