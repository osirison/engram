// Two-pass + deferred link resolution (WP4 §T5). Turns each fact's
// `ImportedLink`s into first-class `MemoryLink` rows, resolving targets that
// were imported in the SAME batch (Pass A) or an EARLIER run (Pass B via the
// ledger), and persisting still-unresolved links as deferred (null-target) rows
// that a later import fills in (`resolveDeferred`).
//
// Locator lifecycle (SHARED-1 invariants): a resolved link's `targetLocator` is
// the deterministic `id:<memoryId>`; the source-derived `slug:`/`path:` locator
// is retained in `metadata.originalLocator` so that if the target is later
// deleted (FK SET NULL → targetMemoryId null), a re-import of the target
// re-resolves it. The unique `(sourceMemoryId, targetLocator, relType)`
// constraint makes every upsert idempotent — re-runs never double links.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@engram/database';
import { posix as posixPath } from 'node:path';
import { slugify } from '@engram/memory-interchange';
import { ImportLedgerService, type LedgerEntry } from '../ledger/import-ledger.service.js';
import { fileStemSlug } from '../parse/links.js';
import type { ImportedLink, SourceTool } from '../ir/types.js';

/** A persisted fact handed to the resolver (memory already written by T3). */
export interface ResolverFact {
  memoryId: string;
  sourceTool: SourceTool;
  sourcePath: string;
  anchor?: string;
  frontmatter?: Record<string, unknown>;
  links: ImportedLink[];
}

export interface ResolveBatchInput {
  userId: string;
  organizationId?: string;
  importBatchId: string;
  facts: ResolverFact[];
}

export interface LinkResolutionSummary {
  /** Links that resolved to a target memory this run. */
  resolved: number;
  /** Links persisted with a null target (still dangling after this run). */
  deferred: number;
  /** Total links processed. */
  total: number;
}

type LocatorIndex = Map<string, string>; // locator → memoryId

@Injectable()
export class LinkResolver {
  private readonly logger = new Logger(LinkResolver.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: ImportLedgerService
  ) {}

  /** Resolve + persist every link in a freshly-imported batch. */
  async resolveBatch(input: ResolveBatchInput): Promise<LinkResolutionSummary> {
    const batchIndex = this.indexFacts(input.facts);
    const ledgerIndex = this.indexLedger(await this.ledger.listByUser(input.userId));

    const summary: LinkResolutionSummary = { resolved: 0, deferred: 0, total: 0 };
    for (const fact of input.facts) {
      for (const link of fact.links) {
        summary.total++;
        const targetId = await this.resolveLocator(
          link.targetLocator,
          [batchIndex, ledgerIndex],
          input.userId,
          input.organizationId
        );
        // A locator that resolves to the fact itself is not a real edge — treat
        // it as unresolved so the summary matches what persistLink stores.
        const resolved = targetId !== null && targetId !== fact.memoryId;
        await this.persistLink(input, fact, link, targetId);
        if (resolved) summary.resolved++;
        else summary.deferred++;
      }
    }
    return summary;
  }

  /**
   * Fill previously-deferred links whose target now exists (called after every
   * batch persists). Uses the retained source-derived locator so a target
   * imported later — or re-imported after deletion — re-resolves. Returns the
   * number of links newly resolved.
   */
  async resolveDeferred(userId: string): Promise<number> {
    const deferred = await this.prisma.memoryLink.findMany({
      where: { userId, targetMemoryId: null },
    });
    if (deferred.length === 0) return 0;

    const ledgerIndex = this.indexLedger(await this.ledger.listByUser(userId));
    let filled = 0;
    for (const row of deferred) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const original =
        typeof meta['originalLocator'] === 'string'
          ? (meta['originalLocator'] as string)
          : row.targetLocator;
      const targetId = await this.resolveLocator(original, [ledgerIndex], userId, undefined);
      if (!targetId || targetId === row.sourceMemoryId) continue; // never self-link

      const desired = `id:${targetId}`;
      const clash = await this.prisma.memoryLink.findUnique({
        where: {
          sourceMemoryId_targetLocator_relType: {
            sourceMemoryId: row.sourceMemoryId,
            targetLocator: desired,
            relType: row.relType,
          },
        },
      });
      if (clash && clash.id !== row.id) {
        // A resolved row for this edge already exists — drop the deferred dup.
        await this.prisma.memoryLink.delete({ where: { id: row.id } });
      } else {
        await this.prisma.memoryLink.update({
          where: { id: row.id },
          data: { targetMemoryId: targetId, targetLocator: desired },
        });
      }
      filled++;
    }
    return filled;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * Resolve a locator to a memory id. `id:<x>` resolves when x is a known
   * imported memory or an existing memory owned by the user; `slug:`/`path:`
   * resolve via the supplied in-memory indexes. Order-preserving: the first
   * index (batch) wins over the ledger.
   */
  private async resolveLocator(
    locator: string,
    indexes: LocatorIndex[],
    userId: string,
    organizationId: string | undefined
  ): Promise<string | null> {
    for (const index of indexes) {
      const hit = index.get(locator);
      if (hit) return hit;
    }
    if (locator.startsWith('id:')) {
      const id = locator.slice(3);
      if (id.length === 0) return null;
      const row = await this.prisma.memory.findFirst({
        where: organizationId !== undefined ? { id, userId, organizationId } : { id, userId },
        select: { id: true },
      });
      return row ? row.id : null;
    }
    return null;
  }

  /** Persist one link as a `MemoryLink` upsert (idempotent on the unique key). */
  private async persistLink(
    input: ResolveBatchInput,
    fact: ResolverFact,
    link: ImportedLink,
    targetId: string | null
  ): Promise<void> {
    const resolved = targetId !== null && targetId !== fact.memoryId;
    const finalTargetId = resolved ? targetId : null;
    const targetLocator = resolved ? `id:${targetId}` : link.targetLocator;

    // When a formerly-deferred link now resolves, clear the stale null-target
    // row keyed on the source-derived locator so it is not orphaned.
    if (resolved && targetLocator !== link.targetLocator) {
      await this.prisma.memoryLink.deleteMany({
        where: {
          sourceMemoryId: fact.memoryId,
          targetLocator: link.targetLocator,
          relType: link.relType,
        },
      });
    }

    const metadata = {
      rawTarget: link.rawTarget,
      kind: link.kind,
      sourceTool: fact.sourceTool,
      importBatchId: input.importBatchId,
      originalLocator: link.targetLocator,
    };
    const base = {
      userId: input.userId,
      organizationId: input.organizationId ?? null,
      sourceMemoryId: fact.memoryId,
      targetMemoryId: finalTargetId,
      relType: link.relType,
      origin: 'authored',
      metadata: metadata as object,
    };
    await this.prisma.memoryLink.upsert({
      where: {
        sourceMemoryId_targetLocator_relType: {
          sourceMemoryId: fact.memoryId,
          targetLocator,
          relType: link.relType,
        },
      },
      create: { ...base, targetLocator },
      update: { targetMemoryId: finalTargetId, metadata: metadata as object },
    });
  }

  /** Build a locator→memoryId index from the current batch's facts. */
  private indexFacts(facts: ResolverFact[]): LocatorIndex {
    const index: LocatorIndex = new Map();
    for (const fact of facts) {
      for (const locator of this.factLocators(fact)) this.addLocator(index, locator, fact.memoryId);
      this.addLocator(index, `id:${fact.memoryId}`, fact.memoryId);
    }
    return index;
  }

  /** Build a locator→memoryId index from the user's ledger (cross-run, Pass B). */
  private indexLedger(entries: LedgerEntry[]): LocatorIndex {
    const index: LocatorIndex = new Map();
    for (const entry of entries) {
      const { sourcePath, anchor } = this.splitSourceKey(entry.sourceKey, entry.sourcePath);
      this.addLocator(index, `path:${sourcePath}${anchor ? `#${anchor}` : ''}`, entry.memoryId);
      if (!anchor) this.addLocator(index, `path:${sourcePath}`, entry.memoryId);
      const stem = fileStemSlug(posixPath.basename(sourcePath));
      if (stem.length > 0) this.addLocator(index, `slug:${stem}`, entry.memoryId);
      this.addLocator(index, `id:${entry.memoryId}`, entry.memoryId);
    }
    return index;
  }

  /** Locators that resolve TO a fact (mirrors `deriveFactLocators`, plus id:). */
  private factLocators(fact: ResolverFact): string[] {
    const out = new Set<string>();
    out.add(`path:${fact.sourcePath}${fact.anchor ? `#${fact.anchor}` : ''}`);
    if (!fact.anchor) out.add(`path:${fact.sourcePath}`);
    const stem = fileStemSlug(posixPath.basename(fact.sourcePath));
    if (stem.length > 0) out.add(`slug:${stem}`);
    const fmName = fact.frontmatter?.['name'];
    if (typeof fmName === 'string' && fmName.trim().length > 0) out.add(`slug:${slugify(fmName)}`);
    return [...out];
  }

  /** First writer wins; a collision (same slug in two files) is logged (R5). */
  private addLocator(index: LocatorIndex, locator: string, memoryId: string): void {
    const existing = index.get(locator);
    if (existing && existing !== memoryId) {
      this.logger.debug(`Ambiguous locator ${locator}: keeping ${existing}, ignoring ${memoryId}`);
      return;
    }
    index.set(locator, memoryId);
  }

  /** Recover the file path + optional anchor a ledger sourceKey addresses. */
  private splitSourceKey(
    sourceKey: string,
    sourcePath: string
  ): { sourcePath: string; anchor?: string } {
    const hashIdx = sourceKey.indexOf('#');
    if (hashIdx < 0) return { sourcePath };
    return { sourcePath, anchor: sourceKey.slice(hashIdx + 1) };
  }
}
