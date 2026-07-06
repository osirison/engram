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

// ── Shared adapter fact-assembly (T6–T11) ───────────────────────────────────
export {
  buildFacts,
  makeSourceKey,
  type ChunkMode,
  type BuildFactsInput,
} from './adapters/adapter-utils.js';

// ── Content hash (T3 idempotency / drift) ───────────────────────────────────
export { computeContentHash } from './content-hash.js';

// ── Idempotency ledger (T2) ─────────────────────────────────────────────────
export {
  ImportLedgerService,
  type LedgerEntry,
  type UpsertLedgerInput,
} from './ledger/import-ledger.service.js';

// ── Secret / PII scan (T4) ──────────────────────────────────────────────────
export {
  SecretScanner,
  ImportSecretPolicyError,
  type SecretPolicy,
  type SecretMatch,
  type ScanResult,
} from './secrets/secret-scanner.js';

// ── Embedding cost estimator (T14) ──────────────────────────────────────────
export {
  estimateEmbeddingCost,
  EMBEDDING_USD_PER_MILLION,
  DEFAULT_EMBEDDING_MODEL,
  type CostEstimate,
} from './embedding/cost-estimator.js';

// ── Source adapters (T6–T11) + registry (T3) ────────────────────────────────
export { ClaudeCodeAdapter, CLAUDE_CODE_ADAPTER_VERSION } from './adapters/claude-code.adapter.js';
export { CopilotAdapter, COPILOT_ADAPTER_VERSION } from './adapters/copilot.adapter.js';
export { CursorAdapter, CURSOR_ADAPTER_VERSION } from './adapters/cursor.adapter.js';
export { CodexAdapter, CODEX_ADAPTER_VERSION } from './adapters/codex.adapter.js';
export { GeminiAdapter, GEMINI_ADAPTER_VERSION } from './adapters/gemini.adapter.js';
export { MarkdownAdapter, MARKDOWN_ADAPTER_VERSION } from './adapters/markdown.adapter.js';
export {
  ADAPTER_REGISTRY,
  buildAdapterRegistry,
  type AdapterRegistry,
} from './adapters/registry.js';

// ── Link resolution (T5) ────────────────────────────────────────────────────
export {
  LinkResolver,
  type ResolverFact,
  type ResolveBatchInput,
  type LinkResolutionSummary,
} from './links/link-resolver.service.js';

// ── Import pipeline (T3) ────────────────────────────────────────────────────
export {
  MemoryImportService,
  type ImportRunInput,
  type ImportSummary,
  type ImportLinkSummary,
} from './memory-import.service.js';

// ── NestJS module ───────────────────────────────────────────────────────────
export { MemoryImportModule } from './memory-import.module.js';
