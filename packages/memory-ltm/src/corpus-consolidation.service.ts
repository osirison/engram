import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { PrismaService, MemoryType } from '@engram/database';
import {
  VECTOR_STORE_TOKEN,
  type VectorStore,
  type VectorSearchResult,
} from '@engram/vector-store';
import { MemoryLtmService } from './memory-ltm.service';
import { ContradictionDetectionService } from './contradiction-detection.service';
import {
  CorpusConsolidationOptions,
  CorpusConsolidationResult,
  ConsolidationClusterReport,
  MAX_CLUSTER_REPORTS,
} from './types';

/**
 * Default lower bound of the near-duplicate merge band. Overridable via the
 * boot-validated `MEMORY_CONSOLIDATION_MERGE_THRESHOLD` (must stay strictly
 * below `MEMORY_DUPLICATE_THRESHOLD` — enforced by @engram/config at boot).
 */
export const DEFAULT_CONSOLIDATION_MERGE_THRESHOLD = 0.85;
/** Mirrors DuplicateDetectionService's default upper bound (exclusive). */
const DEFAULT_DUPLICATE_THRESHOLD = 0.97;
/** Nearest-neighbour candidates fetched per seed row. */
const CANDIDATE_FETCH_LIMIT = 20;

/** Raw Prisma row shape used by this job (matches PrismaMemory in memory-ltm.service). */
type RawMemoryRow = {
  id: string;
  userId: string;
  organizationId: string | null;
  scope: string | null;
  content: string;
  metadata: unknown;
  tags: string[];
  type: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  embedding: number[];
};

/**
 * Periodic corpus consolidation (G3-T2): clusters NEAR-duplicate long-term
 * memories in the `[mergeThreshold, duplicateThreshold)` similarity band —
 * the band write-time dedup deliberately leaves alone, which otherwise
 * accumulates unbounded — keeps one canonical per cluster, and supersedes the
 * rest.
 *
 * NOT the STM→LTM promotion pass: `consolidate_memories` /
 * `ConsolidationService` (apps/mcp-server) is a different, unrelated job.
 *
 * Merge semantics (pinned Decisions 8/9 + WRAPUP-PLAN §2 B5):
 *  - canonical = highest `metadata.importance`, tie-break most recent
 *    `createdAt`;
 *  - the union of every cluster member's tags is CAS-written onto the
 *    canonical;
 *  - each loser gets EXACTLY the write-time supersede markers
 *    ({@link ContradictionDetectionService.annotateSuperseded}: `status`,
 *    `supersededBy`, `supersededReason`, `supersededAt` in metadata JSON —
 *    zero schema changes), a derived `duplicate-of` MemoryLink to the
 *    canonical, and a system-actor audit row (`corpus_consolidation`), so the
 *    G3-T1 recall exclusion and `get_memory` retrieval Just Work;
 *  - every mutation rides the G3-T3 CAS path
 *    ({@link MemoryLtmService.casMetadataUpdate}): retry ONCE from a fresh
 *    read, then skip and count `skippedConcurrentEdit` — a background merge
 *    never clobbers a concurrent user edit.
 *
 * Exclusions: rows already superseded, contradiction-flagged pairs
 * (`status='contradicted'` / `contradictionWith` — deliberately kept by
 * G3-T4), `embeddingExcluded` rows, and rows without a stored vector are
 * skipped as seeds AND filtered out of candidate sets. Losers stay in the
 * vector index (like write-time supersede) — recall filters them post-
 * hydration, and Postgres remains the source of truth.
 *
 * Idempotent: a re-run finds nothing new because losers are now superseded.
 * Cursor-resumable using the `applyDecayPolicy` pattern. REVIEW-GATED
 * (pinned Decision 3): `run()` defaults to `dryRun: true` and mutates nothing
 * unless the caller passes `dryRun: false` explicitly.
 */
@Injectable()
export class CorpusConsolidationService {
  private readonly logger = new Logger(CorpusConsolidationService.name);
  private readonly mergeThreshold: number;
  private readonly duplicateThreshold: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ltmService: MemoryLtmService,
    private readonly contradictionDetection: ContradictionDetectionService,
    @Optional()
    @Inject(VECTOR_STORE_TOKEN)
    private readonly vectorStore?: VectorStore
  ) {
    // Same consumption pattern as DuplicateDetectionService (G3-T5): the pair
    // is schema-validated at boot by @engram/config (merge < duplicate); the
    // raw reads here fall back to the defaults on anything invalid.
    this.mergeThreshold = this.resolveThreshold(
      process.env.MEMORY_CONSOLIDATION_MERGE_THRESHOLD,
      DEFAULT_CONSOLIDATION_MERGE_THRESHOLD
    );
    this.duplicateThreshold = this.resolveThreshold(
      process.env.MEMORY_DUPLICATE_THRESHOLD,
      DEFAULT_DUPLICATE_THRESHOLD
    );
  }

  getMergeThreshold(): number {
    return this.mergeThreshold;
  }

  getDuplicateThreshold(): number {
    return this.duplicateThreshold;
  }

  /**
   * Run one (resumable slice of a) consolidation pass. See the class doc for
   * semantics. Defaults to `dryRun: true` — the review gate — so calling this
   * without options NEVER mutates.
   */
  async run(options: CorpusConsolidationOptions = {}): Promise<CorpusConsolidationResult> {
    const dryRun = options.dryRun ?? true;
    const empty: CorpusConsolidationResult = {
      scanned: 0,
      clusters: 0,
      merged: 0,
      skippedConcurrentEdit: 0,
      cursor: null,
      dryRun,
      perCluster: [],
      perClusterTruncated: false,
    };

    if (!this.vectorStore) {
      this.logger.warn('Corpus consolidation requested but no vector store is configured');
      return empty;
    }
    if (this.mergeThreshold >= this.duplicateThreshold) {
      // Unreachable behind a boot-validated config, but guard direct
      // construction: an empty/inverted band must never merge everything.
      this.logger.warn(
        `Corpus consolidation skipped: merge threshold ${this.mergeThreshold} is not below duplicate threshold ${this.duplicateThreshold}`
      );
      return empty;
    }

    const batchSize = this.normalizeBatchSize(options.batchSize);
    const maxSeeds =
      typeof options.limit === 'number' && Number.isInteger(options.limit) && options.limit > 0
        ? options.limit
        : undefined;

    let cursor = options.cursor;
    let scanned = 0;
    let clusters = 0;
    let merged = 0;
    let skippedConcurrentEdit = 0;
    let exhausted = false;
    const perCluster: ConsolidationClusterReport[] = [];
    let perClusterTruncated = false;
    // Ids already assigned to a cluster THIS run (canonical or loser): a
    // memory participates in at most one merge per pass.
    const claimed = new Set<string>();

    for (;;) {
      const take = maxSeeds !== undefined ? Math.min(batchSize, maxSeeds - scanned) : batchSize;
      if (take <= 0) {
        break;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const batch: RawMemoryRow[] = await (this.prisma as any).memory.findMany({
        where: {
          type: MemoryType.LONG_TERM,
          ...(options.userId ? { userId: options.userId } : {}),
          ...(options.scope ? { scope: options.scope } : {}),
        },
        orderBy: { id: 'asc' },
        take,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (batch.length === 0) {
        exhausted = true;
        break;
      }

      for (const seed of batch) {
        scanned += 1;
        if (!this.isEligible(seed) || claimed.has(seed.id)) {
          continue;
        }

        const candidates = await this.findClusterCandidates(seed, claimed);
        if (candidates.length === 0) {
          continue;
        }

        const cluster = [seed, ...candidates.map((candidate) => candidate.row)];
        const canonical = this.electCanonical(cluster);
        const losers = cluster.filter((member) => member.id !== canonical.id);
        const scoreByMemberId = new Map(
          candidates.map((candidate) => [candidate.row.id, candidate.score])
        );
        const unionedTags = this.unionTags(canonical.tags, cluster);

        clusters += 1;
        for (const member of cluster) {
          claimed.add(member.id);
        }

        const report: ConsolidationClusterReport = {
          canonicalId: canonical.id,
          loserIds: losers.map((loser) => loser.id),
          // The seed has no hit score of its own; when it lost the election,
          // report its similarity to the canonical (same pair, other side).
          scores: losers.map(
            (loser) => scoreByMemberId.get(loser.id) ?? scoreByMemberId.get(canonical.id) ?? 0
          ),
          unionedTags,
        };
        if (perCluster.length < MAX_CLUSTER_REPORTS) {
          perCluster.push(report);
        } else {
          perClusterTruncated = true;
        }

        if (dryRun) {
          merged += losers.length;
          continue;
        }

        // ── Mutations (dryRun: false only) ────────────────────────────────
        if (!this.sameTagSet(unionedTags, canonical.tags)) {
          const tagOutcome = await this.unionTagsWithCas(canonical, cluster);
          if (tagOutcome === 'conflict') {
            skippedConcurrentEdit += 1;
          }
        }

        for (const loser of losers) {
          const score = report.scores[report.loserIds.indexOf(loser.id)] ?? 0;
          const outcome = await this.supersedeLoserWithCas(loser, canonical.id, score);
          if (outcome === 'superseded') {
            merged += 1;
          } else if (outcome === 'conflict') {
            skippedConcurrentEdit += 1;
          }
          // 'gone' / 'already-superseded': nothing to count — the row was
          // deleted or merged concurrently; the pass stays idempotent.
        }
      }

      const lastRow = batch[batch.length - 1];
      cursor = lastRow?.id ?? cursor;
      if (batch.length < take) {
        exhausted = true;
        break;
      }
    }

    const result: CorpusConsolidationResult = {
      scanned,
      clusters,
      merged,
      skippedConcurrentEdit,
      cursor: exhausted ? null : (cursor ?? null),
      dryRun,
      perCluster,
      perClusterTruncated,
    };
    this.logger.log(
      `Corpus consolidation ${dryRun ? 'DRY-RUN ' : ''}pass: scanned=${scanned} clusters=${clusters} merged=${merged} skippedConcurrentEdit=${skippedConcurrentEdit}`
    );
    return result;
  }

  /**
   * Vector-search the seed's own user+org+scope namespace and hydrate the
   * eligible in-band candidates from Postgres (the source of truth). Hits are
   * re-filtered against the seed's scope (the store cannot express "scope IS
   * NULL") and against the lifecycle exclusions — superseded rows in
   * particular are still IN the vector index by design, so the metadata
   * filter here is what makes re-runs idempotent.
   */
  private async findClusterCandidates(
    seed: RawMemoryRow,
    claimed: Set<string>
  ): Promise<Array<{ row: RawMemoryRow; score: number }>> {
    const hits = await this.vectorStore!.search(
      seed.embedding,
      {
        userId: seed.userId,
        organizationId: seed.organizationId ?? undefined,
        scope: seed.scope ?? undefined,
        type: MemoryType.LONG_TERM,
      },
      CANDIDATE_FETCH_LIMIT
    );

    const inBand = hits.filter(
      (hit) =>
        hit.id !== seed.id &&
        !claimed.has(hit.id) &&
        hit.score >= this.mergeThreshold &&
        hit.score < this.duplicateThreshold &&
        this.hitMatchesScope(hit, seed.scope ?? undefined)
    );
    if (inBand.length === 0) {
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: RawMemoryRow[] = await (this.prisma as any).memory.findMany({
      where: {
        id: { in: inBand.map((hit) => hit.id) },
        userId: seed.userId,
        organizationId: seed.organizationId,
        type: MemoryType.LONG_TERM,
        // `scope ?? null` confines the cluster to the seed's own namespace
        // (NULL = unscoped), mirroring write-time dedup.
        scope: seed.scope ?? null,
      },
    });
    const scoreById = new Map(inBand.map((hit) => [hit.id, hit.score]));

    return rows
      .filter((row) => this.isEligible(row))
      .map((row) => ({ row, score: scoreById.get(row.id) ?? 0 }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * A row may participate in clustering only when it is:
   *  - not already superseded (G3-T1 recall exclusion marker),
   *  - not part of a deliberately-kept contradiction pair (G3-T4),
   *  - not held out of the embedding/vector index (`embeddingExcluded`), and
   *  - carrying a stored vector (vector search cannot see it otherwise).
   */
  private isEligible(row: RawMemoryRow): boolean {
    const metadata = this.asMetadata(row.metadata);
    return (
      !this.isSuperseded(metadata) &&
      !this.isContradicted(metadata) &&
      metadata?.['embeddingExcluded'] !== true &&
      Array.isArray(row.embedding) &&
      row.embedding.length > 0
    );
  }

  /** Canonical = highest importance; tie-break most recent createdAt; final tie-break lowest id (determinism). */
  private electCanonical(cluster: RawMemoryRow[]): RawMemoryRow {
    return cluster.reduce((best, row) => {
      const bestImportance = this.readImportance(this.asMetadata(best.metadata));
      const rowImportance = this.readImportance(this.asMetadata(row.metadata));
      if (rowImportance !== bestImportance) {
        return rowImportance > bestImportance ? row : best;
      }
      const bestCreated = best.createdAt?.getTime() ?? 0;
      const rowCreated = row.createdAt?.getTime() ?? 0;
      if (rowCreated !== bestCreated) {
        return rowCreated > bestCreated ? row : best;
      }
      return row.id < best.id ? row : best;
    });
  }

  /** Union of the canonical's tags plus every member's tags, first-seen order. */
  private unionTags(canonicalTags: string[], cluster: RawMemoryRow[]): string[] {
    const union = [...canonicalTags];
    const seen = new Set(canonicalTags);
    for (const member of cluster) {
      for (const tag of member.tags ?? []) {
        if (!seen.has(tag)) {
          seen.add(tag);
          union.push(tag);
        }
      }
    }
    return union;
  }

  private sameTagSet(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const set = new Set(b);
    return a.every((tag) => set.has(tag));
  }

  /**
   * CAS the tag union onto the canonical (G3-T3 protocol): keyed to the
   * version we read; on a miss the union is RECOMPUTED against the fresh
   * row's tags (a concurrent edit may have added or removed tags) and retried
   * ONCE; a second miss skips — the next pass converges it. The canonical's
   * vector-store payload keeps its old tags until the next reindex (the store
   * is a derived index; Postgres is the source of truth).
   */
  private async unionTagsWithCas(
    canonical: RawMemoryRow,
    cluster: RawMemoryRow[]
  ): Promise<'updated' | 'conflict' | 'noop'> {
    let target = canonical;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const nextTags = this.unionTags(target.tags, cluster);
      if (this.sameTagSet(nextTags, target.tags)) {
        return 'noop';
      }
      const updated = await this.ltmService.casMetadataUpdate(
        target.id,
        target.userId,
        target.organizationId ?? undefined,
        target.version,
        { tags: nextTags }
      );
      if (updated) {
        return 'updated';
      }
      if (attempt === 1) {
        break;
      }
      const fresh = await this.findRaw(target);
      if (!fresh) {
        return 'noop'; // canonical deleted concurrently — nothing to union onto
      }
      target = fresh;
    }
    this.logger.debug(
      `Skipping consolidation tag union for memory ${canonical.id}: version conflicted twice`
    );
    return 'conflict';
  }

  /**
   * Mark one loser superseded by the canonical — the EXACT write-time
   * supersede markers via {@link ContradictionDetectionService.annotateSuperseded}
   * — through the G3-T3 CAS protocol (retry ONCE from a fresh read, then
   * skip). On success: an idempotent derived `duplicate-of` MemoryLink
   * (loser → canonical) and a system-actor `supersede` audit row
   * (`corpus_consolidation`), both best-effort mirrors of the write-time
   * supersede path.
   */
  private async supersedeLoserWithCas(
    loser: RawMemoryRow,
    canonicalId: string,
    score: number
  ): Promise<'superseded' | 'conflict' | 'gone' | 'already-superseded'> {
    const reason = `near-duplicate consolidation (similarity ${score.toFixed(4)})`;
    let existing = loser;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const updatedMeta = this.contradictionDetection.annotateSuperseded(
        this.asMetadata(existing.metadata),
        canonicalId,
        reason
      );
      const updated = await this.ltmService.casMetadataUpdate(
        existing.id,
        existing.userId,
        existing.organizationId ?? undefined,
        existing.version,
        { metadata: updatedMeta }
      );
      if (updated) {
        await this.linkDuplicate(existing, canonicalId, score, reason).catch((error: unknown) =>
          this.logger.warn(
            `Failed to link consolidated pair ${existing.id} → ${canonicalId}: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        );
        // Same audit writer as decay-prune / write-time supersede (G3-T3);
        // best-effort — recordLifecycleAudit never throws.
        await this.ltmService.recordLifecycleAudit({
          memoryId: existing.id,
          userId: existing.userId,
          organizationId: existing.organizationId ?? null,
          scope: existing.scope ?? null,
          action: 'supersede',
          actorId: 'corpus_consolidation',
          before: this.buildAuditSnapshot(existing),
          after: { superseded: true, supersededBy: canonicalId, supersededReason: reason },
        });
        return 'superseded';
      }
      if (attempt === 1) {
        break;
      }
      // CAS missed: re-read so the marker merges into the concurrent edit's
      // metadata instead of overwriting it — and re-check eligibility, since
      // the concurrent edit may have disqualified the row.
      const fresh = await this.findRaw(existing);
      if (!fresh) {
        return 'gone'; // deleted concurrently — nothing left to supersede
      }
      const freshMeta = this.asMetadata(fresh.metadata);
      if (this.isSuperseded(freshMeta)) {
        return 'already-superseded'; // another pass/writer beat us — idempotent
      }
      if (this.isContradicted(freshMeta)) {
        // Concurrently flagged as a kept contradiction pair (G3-T4) — merging
        // it now would collapse a deliberately-kept pair.
        this.logger.debug(
          `Skipping consolidation supersede for memory ${existing.id}: concurrently contradiction-flagged`
        );
        return 'conflict';
      }
      existing = fresh;
    }
    this.logger.debug(
      `Skipping consolidation supersede for memory ${loser.id}: version conflicted twice (concurrent edits win)`
    );
    return 'conflict';
  }

  /**
   * Idempotent derived edge recording WHY the loser is hidden: the loser is a
   * `duplicate-of` the canonical. `duplicate-of` comes from the closed
   * EDGE_TYPES vocabulary (@engram/memory-interchange) and — like the
   * `contradicts` edge written by `linkContradiction` — is its own inverse,
   * so a single row (source=loser, target=canonical by convention) captures
   * the relation in both directions. The supersede ACTION itself lives in the
   * loser's metadata (`supersededBy`) and the audit trail. `origin: 'derived'`
   * because the edge is reproducible by re-running detection (WP3 §4.3).
   */
  private async linkDuplicate(
    loser: RawMemoryRow,
    canonicalId: string,
    score: number,
    note: string
  ): Promise<void> {
    const targetLocator = `id:${canonicalId}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.prisma as any).memoryLink.upsert({
      where: {
        sourceMemoryId_targetLocator_relType: {
          sourceMemoryId: loser.id,
          targetLocator,
          relType: 'duplicate-of',
        },
      },
      create: {
        userId: loser.userId,
        organizationId: loser.organizationId ?? null,
        sourceMemoryId: loser.id,
        targetMemoryId: canonicalId,
        targetLocator,
        relType: 'duplicate-of',
        origin: 'derived',
        score,
        note,
      },
      update: { targetMemoryId: canonicalId, score, note },
    });
  }

  /** Fresh re-read with the same `where` shape as MemoryLtmService.findRawMemory. */
  private async findRaw(row: RawMemoryRow): Promise<RawMemoryRow | null> {
    const where: Record<string, unknown> = {
      id: row.id,
      userId: row.userId,
      type: MemoryType.LONG_TERM,
    };
    if (row.organizationId !== null) {
      where.organizationId = row.organizationId;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.prisma as any).memory.findFirst({ where }) as Promise<RawMemoryRow | null>;
  }

  /** Pre-image snapshot matching the WP2 T5 `MemorySnapshot` shape (see MemoryLtmService.buildAuditSnapshot). */
  private buildAuditSnapshot(row: RawMemoryRow): Record<string, unknown> {
    return {
      content: row.content,
      tags: row.tags,
      metadata: this.asMetadata(row.metadata) ?? null,
      type: 'long-term',
      scope: row.scope ?? null,
      expiresAt: null, // LTM memories never expire
      version: row.version,
    };
  }

  /**
   * Mirrors MemoryLtmService.hitMatchesScope: the vector store cannot express
   * "scope IS NULL", so for an unscoped seed any hit carrying a scope payload
   * is dropped; for a scoped seed the store has already filtered and this
   * re-asserts the invariant.
   */
  private hitMatchesScope(hit: VectorSearchResult, scope: string | undefined): boolean {
    const hitScope =
      typeof hit.payload?.scope === 'string' && hit.payload.scope.length > 0
        ? hit.payload.scope
        : undefined;
    return hitScope === scope;
  }

  private asMetadata(metadata: unknown): Record<string, unknown> | null {
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : null;
  }

  /** Same durable-marker logic as MemoryLtmService.isSuperseded (G3-T1). */
  private isSuperseded(metadata: Record<string, unknown> | null): boolean {
    if (!metadata) return false;
    const supersededBy = metadata['supersededBy'];
    if (typeof supersededBy === 'string' && supersededBy.length > 0) return true;
    return metadata['status'] === 'superseded';
  }

  /**
   * A contradiction-flagged pair is deliberately kept for review (G3-T4);
   * `contradictionWith` is the durable marker (the decay pass may later
   * rewrite `status`), with `status` as the fallback for both-marker rows.
   */
  private isContradicted(metadata: Record<string, unknown> | null): boolean {
    if (!metadata) return false;
    const contradictionWith = metadata['contradictionWith'];
    if (typeof contradictionWith === 'string' && contradictionWith.length > 0) return true;
    return metadata['status'] === 'contradicted';
  }

  private readImportance(metadata: Record<string, unknown> | null): number {
    const importance = metadata?.['importance'];
    return typeof importance === 'number' && Number.isFinite(importance) ? importance : 0.5;
  }

  private normalizeBatchSize(batchSize?: number): number {
    if (!batchSize || !Number.isInteger(batchSize) || batchSize <= 0) {
      return 100;
    }
    return Math.min(batchSize, 1000);
  }

  private resolveThreshold(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
  }
}
