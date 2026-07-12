// Import intermediate representation (IR) — the common contract every source
// adapter (T6–T11) targets and the pipeline (T3) consumes. Adapters are
// filesystem-in / IR-out and MUST NOT touch the database, so they stay
// unit-testable in isolation (WP4 PLAN §T1, D1).

import type { EdgeType } from '@engram/memory-interchange';

/** Tools whose on-disk agent-memory formats the importer understands. */
export type SourceTool = 'claude-code' | 'copilot' | 'cursor' | 'codex' | 'gemini' | 'markdown';

export const SOURCE_TOOLS: readonly SourceTool[] = [
  'claude-code',
  'copilot',
  'cursor',
  'codex',
  'gemini',
  'markdown',
];

/**
 * Provenance class of a persisted `MemoryLink` row — the **DB column** value,
 * `'authored' | 'derived'` (distinct from `@engram/memory-interchange`'s export
 * `EdgeOrigin` of `'durable' | 'derived'`; the WP3 collector maps
 * `authored → durable`, see interchange `edge-types.ts`). Every link written by
 * an import is `'authored'` — the user wrote it into their source file.
 */
export const MEMORY_LINK_ORIGINS = ['authored', 'derived'] as const;
export type MemoryLinkOrigin = (typeof MEMORY_LINK_ORIGINS)[number];

/** How a link was written in the source file. */
export type LinkKind = 'wikilink' | 'md-relative' | 'frontmatter-ref';

/**
 * One inter-memory link extracted from a fact's body/frontmatter, normalized to
 * a resolver-ready locator. `relType` is drawn from the closed interchange
 * `EDGE_TYPES` vocabulary (compiler-enforced) — an untyped wikilink / relative
 * link defaults to `'relates-to'`, so an adapter can never emit a rel that the
 * export `edgeSchema` would reject (WP4 PLAN §T1, G6 round-trip contract).
 */
export interface ImportedLink {
  kind: LinkKind;
  /** The target exactly as written, e.g. `feedback-worktree` or `../AGENTS.md`. */
  rawTarget: string;
  /**
   * Normalized target locator: `slug:<stem>` (wikilinks) or
   * `path:<repo-relative-normalized>[#anchor]` (relative md links). A resolved
   * link's locator becomes `id:<cuid>` (T5) — the deterministic form the unique
   * constraint dedupes on.
   */
  targetLocator: string;
  /** Closed vocabulary; default `'relates-to'` for untyped source links. */
  relType: EdgeType;
}

/**
 * One unit destined to become a single ENGRAM long-term memory. Atomic fact
 * files map 1:1; monolithic instruction files are chunked (D6) into several
 * facts each carrying the section `anchor`.
 */
export interface ImportedFact {
  /** Stable within a single parse batch; the resolver keys the local map on it. */
  localId: string;
  /** e.g. `claude-code:memory/feedback-worktree.md` (`<tool>:<relpath>[#anchor]`). */
  sourceKey: string;
  sourceTool: SourceTool;
  /** Path **relative to the IR `rootPath`** so link `path:` locators resolve. */
  sourcePath: string;
  /** Section slug for chunked instruction files; absent for atomic facts. */
  anchor?: string;
  title?: string;
  content: string;
  tags: string[];
  /**
   * Source frontmatter as parsed (shape preserved). Adapters do NOT sanitize
   * it — the pipeline's secret scan (`scanFacts`) redacts string values under
   * the import secret policy before anything is persisted.
   */
  frontmatter?: Record<string, unknown>;
  links: ImportedLink[];
}

/** Run-level provenance stamped onto every IR (and each memory's metadata). */
export interface ProvenanceCommon {
  /** ISO-8601 UTC — supplied by the caller (T3) so adapters stay deterministic. */
  importedAt: string;
  importBatchId: string;
  host?: string;
  adapterVersion: string;
}

/** The complete output of one `SourceAdapter.parse()` call. */
export interface ImportIR {
  sourceTool: SourceTool;
  /** Absolute filesystem root the parse walked; `sourcePath`s are relative to it. */
  rootPath: string;
  facts: ImportedFact[];
  provenance: ProvenanceCommon;
}
