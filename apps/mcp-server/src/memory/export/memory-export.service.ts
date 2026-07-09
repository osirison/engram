import { Injectable, Logger, Optional } from '@nestjs/common';
import { MemoryLtmService, type LtmMemory } from '@engram/memory-ltm';
import { MemoryStmService, type StmMemory } from '@engram/memory-stm';
import { MemoryAuditService } from '../memory-audit.service';
import {
  MEMORY_INTERCHANGE_VERSION,
  buildFilename,
  firstNonEmptyLine,
  serializeMemory,
  slugify,
  type CanonicalMemory,
} from '@engram/memory-interchange';
import {
  collectEdges,
  type CollectableMemory,
  type CollectableMemoryLink,
} from './edge-collector';
import type {
  ExportFailure,
  ExportManifest,
  ExportMode,
  ExportResult,
  ExportSink,
  ExportTypeFilter,
  MemoryExportOptions,
} from './export.types';

/** A memory as returned by either tier service (both extend the base `Memory`). */
type SourceMemory = LtmMemory | StmMemory;

/** LTM page size; STM SCAN `count` hint. */
const PAGE_SIZE = 100;

/** Belt-and-suspenders bound on STM SCAN paging in case a cursor never resets. */
const MAX_STM_PAGES = 100_000;

/**
 * Metadata keys stripped before export (PLAN §4.7):
 * (a) relationship keys already consumed into typed `links` by the collector;
 * (b) volatile runtime keys that are not relationships and would defeat
 *     byte-stable, diffable output.
 */
const RELATIONSHIP_METADATA_KEYS = new Set([
  'duplicateMatches',
  'contradictionMatches',
  'supersededBy',
  'supersededReason',
  'supersededAt',
  'sourceMemoryIds',
  'insightId',
  'clusteredAt',
  'isInsight',
  'topic',
  'clusterSize',
  'extractedAt',
]);
const VOLATILE_METADATA_KEYS = new Set([
  'importance',
  'status',
  'accessCount',
  'lastAccessedAt',
  'pinned',
  'detectedAt',
]);

const REINDEX_NOTE =
  'Embeddings are excluded from this export (a derived index). Run the ENGRAM ' +
  '`reindex` job after import to rebuild vectors.';
const STM_TTL_NOTE =
  'Short-term memories carry a point-in-time `expiresAt`; their TTL countdown is ' +
  'NOT preserved on round-trip (PLAN §4.6). Import recreates them with a fresh TTL.';
const HISTORY_NOTE =
  'Audit history is included under `_history/<id>.json` (G5). These sidecars can ' +
  'contain superseded prior content; they are NOT re-imported (the WP4 importer ' +
  'reads `.md` only).';

/** Rows per memory captured into a history sidecar (mirrors the audit list() cap). */
const HISTORY_LIMIT = 200;

/**
 * Orchestrates a rich-markdown export (WP3 PLAN §T5). Pages LTM (and optionally
 * STM), sanitizes each memory, collects typed edges over the whole set, and
 * serializes each to per-memory files (or one single-doc file) plus a Map-of-
 * Content `index.md` and a machine-readable `manifest.json`. Per-item failures
 * are counted and skipped — the export never aborts (mirrors `reindex`).
 *
 * The core is sink-agnostic (dir writer / zip stream / in-memory) so it drives
 * every delivery surface (CLI, MCP, web).
 */
@Injectable()
export class MemoryExportService {
  private readonly logger = new Logger(MemoryExportService.name);

  constructor(
    private readonly ltm: MemoryLtmService,
    @Optional() private readonly stm?: MemoryStmService,
    @Optional() private readonly audit?: MemoryAuditService,
  ) {}

  async export(
    options: MemoryExportOptions,
    sink: ExportSink,
  ): Promise<ExportResult> {
    const mode: ExportMode = options.mode ?? 'multi';
    const memories = this.dedupeAndSort(await this.collectMemories(options));

    const collectable: CollectableMemory[] = memories.map((m) => ({
      id: m.id,
      metadata: m.metadata ?? null,
    }));
    const links = await this.loadMemoryLinks(
      options.userId,
      memories.map((m) => m.id),
    );
    const collected = collectEdges(collectable, links);

    const displayById = new Map(
      memories.map((m) => [m.id, firstNonEmptyLine(m.content) || m.id]),
    );
    const linkDisplay = (id: string): string | undefined => displayById.get(id);

    const failed: ExportFailure[] = [];
    const written: WrittenEntry[] = [];
    const exported: SourceMemory[] = [];

    const singleSections: string[] = [];
    for (const memory of memories) {
      try {
        const canonical = this.toCanonical(memory);
        const edges = collected.byMemory.get(memory.id) ?? [];
        const doc = serializeMemory({
          memory: canonical,
          edges,
          mode,
          linkDisplay,
        });
        const title = displayById.get(memory.id) ?? memory.id;
        if (mode === 'single') {
          singleSections.push(doc);
        } else {
          const relativePath = `memories/${buildFilename(memory.id, memory.content)}`;
          await sink.writeFile(relativePath, doc);
          written.push({
            id: memory.id,
            type: canonical.type,
            title,
            tags: canonical.tags,
            relativePath,
          });
        }
        exported.push(memory);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Skipping memory ${memory.id} during export: ${error}`,
        );
        failed.push({ id: memory.id, error });
      }
    }

    let fileCount = written.length;
    if (mode === 'single') {
      await sink.writeFile('memories.md', this.buildSingleDoc(singleSections));
      fileCount = singleSections.length > 0 ? 1 : 0;
    } else {
      await sink.writeFile('index.md', this.buildMoc(written, memories.length));
    }

    // G5: opt-in audit-history sidecars. Independent of serialize failures above —
    // only successfully-exported memories get a `_history/<id>.json` companion.
    const historyFiles = options.includeHistory
      ? await this.writeHistory(options.userId, exported, sink)
      : 0;

    const manifest = this.buildManifest(
      options,
      mode,
      memories,
      written,
      failed,
      collected.danglingTargets,
      historyFiles,
    );
    await sink.writeFile(
      'manifest.json',
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    this.logger.log(
      `Exported ${memories.length} memories (${failed.length} failed) for user ${options.userId}`,
    );
    return { manifest, fileCount, failed };
  }

  /**
   * Load first-class `MemoryLink` rows (SHARED-1) for the export set. Returns
   * `undefined` until SHARED-1 lands — the collector then reads metadata edges
   * only, which is fully functional for everything that exists today (PLAN §5
   * dependency note). WP-later: query `prisma.memoryLink` and map to
   * {@link CollectableMemoryLink}.
   */
  protected loadMemoryLinks(
    userId: string,
    ids: readonly string[],
  ): Promise<CollectableMemoryLink[] | undefined> {
    this.logger.debug(
      `MemoryLink source not enabled (SHARED-1 pending); ${ids.length} memories ` +
        `for ${userId} use metadata edges only`,
    );
    return Promise.resolve(undefined);
  }

  /**
   * G5: write each exported memory's `memory_audits` trail as a `_history/<id>.json`
   * sidecar. Best-effort per memory — a history read failure is logged and skipped,
   * never aborting the export (mirrors the per-memory serialize policy). Memories
   * with no audit rows get no sidecar. Returns the number of sidecars written.
   */
  private async writeHistory(
    userId: string,
    memories: readonly SourceMemory[],
    sink: ExportSink,
  ): Promise<number> {
    if (!this.audit) {
      this.logger.warn(
        'includeHistory requested but audit service is unavailable; skipping history',
      );
      return 0;
    }
    let count = 0;
    for (const memory of memories) {
      try {
        const entries = await this.audit.list(userId, memory.id, HISTORY_LIMIT);
        if (entries.length === 0) continue;
        const doc = `${JSON.stringify({ memoryId: memory.id, entries }, null, 2)}\n`;
        await sink.writeFile(`_history/${memory.id}.json`, doc);
        count += 1;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Skipping history for memory ${memory.id} during export: ${error}`,
        );
      }
    }
    return count;
  }

  private async collectMemories(
    options: MemoryExportOptions,
  ): Promise<SourceMemory[]> {
    const wantLtm = options.type !== 'short-term';
    const wantStm = options.includeStm === true && options.type !== 'long-term';
    const out: SourceMemory[] = [];

    if (wantLtm) {
      let cursor: string | undefined;
      do {
        const page = await this.ltm.list(options.userId, {
          limit: PAGE_SIZE,
          cursor,
          organizationId: options.organizationId,
          scope: options.scope,
          tags: options.tags,
          dateFrom: options.dateFrom,
          dateTo: options.dateTo,
          sortBy: 'createdAt',
          sortOrder: 'asc',
        });
        out.push(...page.items);
        cursor = page.hasNextPage ? page.endCursor : undefined;
      } while (cursor);
    }

    if (wantStm) {
      if (!this.stm) {
        this.logger.warn(
          'includeStm requested but STM service is unavailable; skipping STM',
        );
      } else {
        out.push(...(await this.collectStm(options)));
      }
    }

    return out;
  }

  /**
   * STM has no first-class date filter and its SCAN order is unstable/duplicative
   * (PLAN §4.6), so we page the whole keyspace, dedupe by id, and apply any date
   * filter client-side. Global id-asc ordering happens later in `dedupeAndSort`.
   */
  private async collectStm(options: MemoryExportOptions): Promise<StmMemory[]> {
    const stm = this.stm;
    if (!stm) return [];
    const items: StmMemory[] = [];
    let cursor = '0';
    let pages = 0;
    do {
      const page = await stm.list(options.userId, {
        limit: PAGE_SIZE,
        cursor,
        organizationId: options.organizationId,
        scope: options.scope,
        tags: options.tags,
      });
      for (const item of page.items) {
        if (this.withinDateRange(item.createdAt, options)) items.push(item);
      }
      cursor = page.hasNextPage ? (page.endCursor ?? '0') : '0';
      pages += 1;
    } while (cursor !== '0' && pages < MAX_STM_PAGES);
    return items;
  }

  private withinDateRange(
    createdAt: Date,
    options: MemoryExportOptions,
  ): boolean {
    if (options.dateFrom && createdAt < options.dateFrom) return false;
    if (options.dateTo && createdAt > options.dateTo) return false;
    return true;
  }

  /** Dedupe by id (STM SCAN can repeat keys) and impose a stable global id-asc order. */
  private dedupeAndSort(memories: readonly SourceMemory[]): SourceMemory[] {
    const byId = new Map<string, SourceMemory>();
    for (const m of memories) if (!byId.has(m.id)) byId.set(m.id, m);
    return [...byId.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
  }

  private toCanonical(memory: SourceMemory): CanonicalMemory {
    return {
      id: memory.id,
      type: memory.type === 'short-term' ? 'short-term' : 'long-term',
      userId: memory.userId,
      scope: memory.scope ?? null,
      organizationId: memory.organizationId ?? null,
      tags: memory.tags ?? [],
      createdAt: memory.createdAt.toISOString(),
      updatedAt: memory.updatedAt.toISOString(),
      expiresAt: memory.expiresAt ? memory.expiresAt.toISOString() : null,
      metadata: sanitizeMetadata(memory.metadata),
      provenance: { source: 'engram', importedFrom: null },
      content: memory.content,
    };
  }

  /** Build the Map-of-Content `index.md`: type → tag → `[[id|title]]` bullets. */
  private buildMoc(entries: readonly WrittenEntry[], total: number): string {
    const lines: string[] = [
      '# Memory Export',
      '',
      `_${total} memories · exported by ENGRAM_`,
      '',
    ];
    const byType = new Map<ExportTypeFilter, WrittenEntry[]>();
    for (const e of entries) {
      const bucket = byType.get(e.type) ?? [];
      bucket.push(e);
      byType.set(e.type, bucket);
    }
    for (const type of ['long-term', 'short-term'] as ExportTypeFilter[]) {
      const group = byType.get(type);
      if (!group || group.length === 0) continue;
      lines.push(`## ${type}`, '');
      const byTag = new Map<string, WrittenEntry[]>();
      for (const e of group) {
        const keys = e.tags.length > 0 ? e.tags : ['(untagged)'];
        for (const tag of keys) {
          const bucket = byTag.get(tag) ?? [];
          bucket.push(e);
          byTag.set(tag, bucket);
        }
      }
      for (const tag of [...byTag.keys()].sort()) {
        lines.push(`### ${tag}`, '');
        for (const e of (byTag.get(tag) ?? []).sort((a, b) =>
          a.id < b.id ? -1 : 1,
        )) {
          lines.push(`- [[${e.id}|${e.title}]]`);
        }
        lines.push('');
      }
    }
    return `${lines.join('\n').trimEnd()}\n`;
  }

  private buildSingleDoc(sections: readonly string[]): string {
    const header = `# Memory Export\n\n_${sections.length} memories · exported by ENGRAM_\n`;
    if (sections.length === 0) return `${header}`;
    return `${header}\n${sections.join('\n')}`;
  }

  private buildManifest(
    options: MemoryExportOptions,
    mode: ExportMode,
    memories: readonly SourceMemory[],
    written: readonly WrittenEntry[],
    failed: readonly ExportFailure[],
    danglingTargets: readonly string[],
    historyFiles: number,
  ): ExportManifest {
    const longTerm = memories.filter((m) => m.type === 'long-term').length;
    const shortTerm = memories.filter((m) => m.type === 'short-term').length;
    const notes = [REINDEX_NOTE];
    if (shortTerm > 0) notes.push(STM_TTL_NOTE);
    if (options.includeHistory && historyFiles > 0) notes.push(HISTORY_NOTE);

    return {
      schemaVersion: MEMORY_INTERCHANGE_VERSION,
      generator: 'engram',
      mode,
      ...(options.deterministic
        ? {}
        : { exportedAt: new Date().toISOString() }),
      filters: {
        userId: options.userId,
        includeStm: options.includeStm === true,
        ...(options.type ? { type: options.type } : {}),
        ...(options.scope ? { scope: options.scope } : {}),
        ...(options.organizationId
          ? { organizationId: options.organizationId }
          : {}),
        ...(options.tags && options.tags.length > 0
          ? { tags: [...options.tags].sort() }
          : {}),
        ...(options.dateFrom
          ? { dateFrom: options.dateFrom.toISOString() }
          : {}),
        ...(options.dateTo ? { dateTo: options.dateTo.toISOString() } : {}),
      },
      counts: {
        total: memories.length,
        longTerm,
        shortTerm,
        files:
          mode === 'single' ? (memories.length > 0 ? 1 : 0) : written.length,
        failed: failed.length,
        ...(options.includeHistory ? { historyFiles } : {}),
      },
      danglingTargets: [...danglingTargets].sort(),
      failedIds: failed.map((f) => f.id).sort(),
      notes,
    };
  }
}

interface WrittenEntry {
  id: string;
  type: ExportTypeFilter;
  title: string;
  tags: string[];
  relativePath: string;
}

/** Strip relationship + volatile keys (PLAN §4.7); return undefined when empty. */
export function sanitizeMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (RELATIONSHIP_METADATA_KEYS.has(key) || VOLATILE_METADATA_KEYS.has(key))
      continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// slugify is re-exported for the CLI/tests that build browsable paths directly.
export { slugify };
