import type { ExportMode } from '@engram/memory-interchange';

export type { ExportMode };

/** Memory tier filter for an export. */
export type ExportTypeFilter = 'short-term' | 'long-term';

/**
 * Options for {@link MemoryExportService.export}. STM is excluded by default
 * (PLAN §4.6): it is transient Redis-backed working memory, so exporting it
 * would capture ephemeral state.
 */
export interface MemoryExportOptions {
  userId: string;
  /** Include short-term (Redis) memories. Default false — LTM only. */
  includeStm?: boolean;
  tags?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  scope?: string;
  organizationId?: string;
  /** Restrict to a single tier. */
  type?: ExportTypeFilter;
  /** `multi` (one file per memory, default) or `single` (one file, anchored). */
  mode?: ExportMode;
  /** Omit `exportedAt` from the manifest for byte-identical CI diffs (PLAN §4.12). */
  deterministic?: boolean;
}

/**
 * Where an export writes its files. Implementations: a directory writer (CLI),
 * an in-memory map (tests/MCP inline), a zip stream (web). Keeping the core
 * behind this abstraction lets one orchestrator drive every delivery surface
 * (PLAN §4.11). Paths are export-root-relative and use `/` separators.
 */
export interface ExportSink {
  writeFile(relativePath: string, content: string): Promise<void> | void;
}

/** A per-memory failure that was counted and skipped, never aborting the export. */
export interface ExportFailure {
  id: string;
  error: string;
}

/** Machine-readable sidecar written as `manifest.json`. */
export interface ExportManifest {
  schemaVersion: string;
  generator: 'engram';
  mode: ExportMode;
  /** ISO-8601 UTC; omitted when `deterministic`. */
  exportedAt?: string;
  filters: {
    userId: string;
    includeStm: boolean;
    type?: ExportTypeFilter;
    scope?: string;
    organizationId?: string;
    tags?: string[];
    dateFrom?: string;
    dateTo?: string;
  };
  counts: {
    total: number;
    longTerm: number;
    shortTerm: number;
    files: number;
    failed: number;
  };
  /** Target ids referenced by an edge but outside the (filtered) export set. */
  danglingTargets: string[];
  /** Ids that failed to serialize and were skipped. */
  failedIds: string[];
  /** Operator-facing notes (reindex reminder, STM TTL caveat, …). */
  notes: string[];
}

export interface ExportResult {
  manifest: ExportManifest;
  /** Number of memory files written (1 in single mode). */
  fileCount: number;
  failed: ExportFailure[];
}
