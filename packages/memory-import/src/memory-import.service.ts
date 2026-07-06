// Import pipeline core (WP4 §T3 / D1). Turns an adapter's ImportIR into
// persisted, deduped, provenance-tracked long-term memories + resolved links —
// idempotently. Does NOT reimplement dedup/embedding: it computes a sourceKey +
// contentHash, consults the ledger, and delegates to MemoryLtmService.create()/
// update() (whose exact-content dedup + semantic dup/contradiction it inherits).

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MemoryLtmService, LtmMemoryQuotaExceededError, type LtmMemory } from '@engram/memory-ltm';
import { ImportLedgerService } from './ledger/import-ledger.service.js';
import { LinkResolver, type ResolverFact } from './links/link-resolver.service.js';
import { SecretScanner, type SecretPolicy } from './secrets/secret-scanner.js';
import { estimateEmbeddingCost, type CostEstimate } from './embedding/cost-estimator.js';
import { computeContentHash } from './content-hash.js';
import { ADAPTER_REGISTRY, type AdapterRegistry } from './adapters/registry.js';
import type { ImportedFact, ImportIR, SourceTool } from './ir/types.js';

export interface ImportRunInput {
  source: SourceTool;
  /** Server-side path the selected adapter parses. */
  path: string;
  userId: string;
  organizationId?: string;
  /** Dedup/link namespace (default `import`). */
  scope?: string;
  secretsPolicy?: SecretPolicy;
  /** Embed inline during import; false ⇒ advise a later reindex (D8/G7). */
  embed?: boolean;
  dryRun?: boolean;
  splitHeadings?: boolean;
  includeGlobal?: boolean;
  importBatchId?: string;
  host?: string;
  /** Embedding model used only for the dry-run cost estimate. */
  model?: string;
}

export interface ImportLinkSummary {
  resolved: number;
  deferred: number;
  /** Deferred links still unresolved after `resolveDeferred` (dangling). */
  dangling: number;
}

export interface ImportSummary {
  source: SourceTool;
  path: string;
  userId: string;
  organizationId?: string;
  scope: string;
  importBatchId: string;
  dryRun: boolean;
  /** Facts the adapter produced. */
  parsed: number;
  created: number;
  updated: number;
  /** Idempotent no-ops (ledger hit, content hash unchanged). */
  skipped: number;
  /** New sourceKey whose content merged into an existing memory (multi-source). */
  mergedIntoExisting: number;
  /** Facts dropped by the `skip` secrets policy. */
  secretsSkipped: number;
  failed: number;
  links: ImportLinkSummary;
  secrets: Array<{ path: string; patterns: string[] }>;
  embeddingCostEstimate: CostEstimate;
  advisories: string[];
  /** On a graceful quota stop: index of the last processed fact (resumable). */
  cursor?: number;
}

/** One imported source's provenance record (D1 multi-source aware). */
interface ProvenanceSource {
  sourceTool: SourceTool;
  sourcePath: string;
  sourceKey: string;
}

@Injectable()
export class MemoryImportService {
  private readonly logger = new Logger(MemoryImportService.name);

  constructor(
    private readonly ltm: MemoryLtmService,
    private readonly ledger: ImportLedgerService,
    private readonly linkResolver: LinkResolver,
    private readonly secrets: SecretScanner,
    @Optional() @Inject(ADAPTER_REGISTRY) private readonly registry?: AdapterRegistry
  ) {}

  async run(input: ImportRunInput): Promise<ImportSummary> {
    const scope = input.scope ?? 'import';
    const secretsPolicy: SecretPolicy = input.secretsPolicy ?? 'redact';
    const embed = input.embed ?? true;
    const dryRun = input.dryRun ?? false;
    const importBatchId = input.importBatchId ?? `import-${randomUUID()}`;
    const importedAt = new Date().toISOString();

    const adapter = this.registry?.get(input.source);
    if (!adapter) {
      throw new Error(`No import adapter registered for source '${input.source}'`);
    }

    const ir = await adapter.parse(input.path, {
      importBatchId,
      importedAt,
      ...(input.host !== undefined ? { host: input.host } : {}),
      ...(input.splitHeadings !== undefined ? { splitHeadings: input.splitHeadings } : {}),
      ...(input.includeGlobal !== undefined ? { includeGlobal: input.includeGlobal } : {}),
    });

    const summary = this.emptySummary(input, scope, importBatchId, dryRun, ir);

    // Secret scan every fact up-front so dry-run and real runs report identically.
    const scanned = this.scanFacts(ir, secretsPolicy, summary);

    if (dryRun) {
      return this.finishDryRun(summary, scanned, input.model);
    }

    const resolverFacts: ResolverFact[] = [];
    for (let i = 0; i < scanned.length; i++) {
      const entry = scanned[i]!;
      if (entry.skip) {
        summary.secretsSkipped++;
        continue;
      }
      try {
        const memoryId = await this.persistFact(
          entry,
          ir,
          scope,
          importBatchId,
          importedAt,
          summary
        );
        if (memoryId) {
          const rf: ResolverFact = {
            memoryId,
            sourceTool: ir.sourceTool,
            sourcePath: entry.fact.sourcePath,
            links: entry.fact.links,
          };
          if (entry.fact.anchor !== undefined) rf.anchor = entry.fact.anchor;
          if (entry.fact.frontmatter !== undefined) rf.frontmatter = entry.fact.frontmatter;
          resolverFacts.push(rf);
        }
      } catch (err) {
        if (err instanceof LtmMemoryQuotaExceededError) {
          this.logger.warn(`Quota exceeded at fact ${i}; stopping import gracefully`);
          summary.cursor = i;
          summary.advisories.push(
            `Import stopped at fact ${i} of ${scanned.length}: per-user memory quota reached. ` +
              `Raise the quota or resume with a higher limit.`
          );
          break;
        }
        summary.failed++;
        this.logger.error(`Fact failed (${entry.fact.sourceKey}): ${(err as Error).message}`);
      }
    }

    await this.resolveLinks(
      input.userId,
      input.organizationId,
      importBatchId,
      resolverFacts,
      summary
    );
    this.finalizeEmbeddingAdvice(summary, scanned, embed, input.model);
    return summary;
  }

  // ── persistence ─────────────────────────────────────────────────────────────

  private async persistFact(
    entry: ScannedFact,
    ir: ImportIR,
    scope: string,
    importBatchId: string,
    importedAt: string,
    summary: ImportSummary
  ): Promise<string | null> {
    const { fact, content, embeddingExcluded, extraTags } = entry;
    const userId = summary.userId;
    const contentHash = computeContentHash(content);
    const existing = await this.ledger.find(userId, fact.sourceKey);

    if (existing && existing.contentHash === contentHash) {
      summary.skipped++;
      return existing.memoryId; // idempotent no-op; links still re-ensured
    }

    const source: ProvenanceSource = {
      sourceTool: ir.sourceTool,
      sourcePath: fact.sourcePath,
      sourceKey: fact.sourceKey,
    };
    const tags = [...new Set([...fact.tags, ...extraTags])];

    let memoryId: string;
    if (existing) {
      // Ledger hit, hash changed → update the mapped memory (re-embeds, merges meta).
      const meta = this.buildMetadata(
        fact,
        importBatchId,
        importedAt,
        ir,
        contentHash,
        embeddingExcluded,
        [source]
      );
      const updated = await this.ltm.update(
        userId,
        existing.memoryId,
        { content, tags, metadataMerge: meta },
        summary.organizationId,
        scope
      );
      memoryId = updated.id;
      summary.updated++;
    } else {
      // Ledger miss → create(); exact-content dedup may return an existing row.
      const priorSameContent = await this.ledger.findByContentHash(userId, contentHash);
      const created = await this.ltm.create({
        userId,
        ...(summary.organizationId !== undefined ? { organizationId: summary.organizationId } : {}),
        scope,
        content,
        tags,
        metadata: this.buildMetadata(
          fact,
          importBatchId,
          importedAt,
          ir,
          contentHash,
          embeddingExcluded,
          [source]
        ),
      });
      memoryId = created.id;
      if (priorSameContent.length > 0) {
        summary.mergedIntoExisting++;
        await this.appendProvenanceSource(created, source, scope, summary);
      } else {
        summary.created++;
      }
    }

    await this.ledger.upsert({
      userId,
      memoryId,
      sourceTool: ir.sourceTool,
      sourcePath: fact.sourcePath,
      sourceKey: fact.sourceKey,
      contentHash,
      importBatchId,
    });
    return memoryId;
  }

  /** Append this source to a merged memory's `provenance.sources[]` (D1). */
  private async appendProvenanceSource(
    memory: LtmMemory,
    source: ProvenanceSource,
    scope: string,
    summary: ImportSummary
  ): Promise<void> {
    const meta = (memory.metadata ?? {}) as Record<string, unknown>;
    const prov = (meta['provenance'] ?? {}) as Record<string, unknown>;
    const existingSources = Array.isArray(prov['sources'])
      ? (prov['sources'] as ProvenanceSource[])
      : [];
    if (existingSources.some((s) => s.sourceKey === source.sourceKey)) return;
    const sources = [...existingSources, source];
    await this.ltm.update(
      summary.userId,
      memory.id,
      { metadataMerge: { provenance: { ...prov, sources } } },
      summary.organizationId,
      scope
    );
  }

  private buildMetadata(
    fact: ImportedFact,
    importBatchId: string,
    importedAt: string,
    ir: ImportIR,
    contentHash: string,
    embeddingExcluded: boolean,
    sources: ProvenanceSource[]
  ): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      provenance: {
        sourceTool: ir.sourceTool,
        sourcePath: fact.sourcePath,
        sourceKey: fact.sourceKey,
        importedAt,
        importBatchId,
        contentHash,
        adapterVersion: ir.provenance.adapterVersion,
        sources,
      },
    };
    if (fact.frontmatter !== undefined) metadata['frontmatter'] = fact.frontmatter;
    if (fact.title !== undefined) metadata['title'] = fact.title;
    if (embeddingExcluded) metadata['embeddingExcluded'] = true;
    return metadata;
  }

  // ── links ────────────────────────────────────────────────────────────────────

  private async resolveLinks(
    userId: string,
    organizationId: string | undefined,
    importBatchId: string,
    facts: ResolverFact[],
    summary: ImportSummary
  ): Promise<void> {
    if (facts.length === 0) {
      // Even with no new facts, a prior deferred link may now resolve.
      await this.linkResolver.resolveDeferred(userId).catch(() => 0);
      return;
    }
    const batch = await this.linkResolver.resolveBatch({
      userId,
      ...(organizationId !== undefined ? { organizationId } : {}),
      importBatchId,
      facts,
    });
    const filled = await this.linkResolver.resolveDeferred(userId).catch(() => 0);
    summary.links.resolved = batch.resolved + filled;
    summary.links.deferred = batch.deferred;
    summary.links.dangling = Math.max(0, batch.deferred - filled);
  }

  // ── secret scanning ───────────────────────────────────────────────────────────

  private scanFacts(ir: ImportIR, policy: SecretPolicy, summary: ImportSummary): ScannedFact[] {
    const out: ScannedFact[] = [];
    for (const fact of ir.facts) {
      // `fail` throws ImportSecretPolicyError up to run()'s caller (aborts).
      const result = this.secrets.apply(
        { content: fact.content, sourcePath: fact.sourcePath },
        policy
      );
      if (result.matches.length > 0) {
        summary.secrets.push({
          path: fact.sourcePath,
          patterns: result.matches.map((m) => m.pattern),
        });
      }
      out.push({
        fact,
        content: result.content,
        skip: result.action === 'skipped',
        embeddingExcluded: result.embeddingExcluded,
        extraTags: result.extraTags,
      });
    }
    return out;
  }

  // ── dry-run + summaries ─────────────────────────────────────────────────────────

  /**
   * Contents that will actually reach the embedding provider: not dropped by
   * the `skip` secrets policy and not `flag`-excluded from embedding. Both the
   * dry-run preview and the real run estimate cost over exactly this set, so the
   * two can never diverge (a `flag`'d fact must not inflate the dry-run figure).
   */
  private embeddableContents(scanned: ScannedFact[]): string[] {
    return scanned.filter((s) => !s.skip && !s.embeddingExcluded).map((s) => s.content);
  }

  private finishDryRun(
    summary: ImportSummary,
    scanned: ScannedFact[],
    model?: string
  ): ImportSummary {
    // Classify without persisting: ledger lookups only.
    const persistable = scanned.filter((s) => !s.skip);
    summary.secretsSkipped = scanned.length - persistable.length;
    summary.embeddingCostEstimate = estimateEmbeddingCost(
      this.embeddableContents(scanned),
      model !== undefined ? { model } : undefined
    );
    summary.advisories.push('Dry run: no memories, links, or ledger rows were written.');
    return summary;
  }

  private finalizeEmbeddingAdvice(
    summary: ImportSummary,
    scanned: ScannedFact[],
    embed: boolean,
    model?: string
  ): void {
    summary.embeddingCostEstimate = estimateEmbeddingCost(
      this.embeddableContents(scanned),
      model !== undefined ? { model } : undefined
    );
    if (!embed) {
      summary.advisories.push(
        'Embeddings skipped (--no-embed): run `pnpm --filter mcp-server reindex` to backfill vectors.'
      );
    }
  }

  private emptySummary(
    input: ImportRunInput,
    scope: string,
    importBatchId: string,
    dryRun: boolean,
    ir: ImportIR
  ): ImportSummary {
    return {
      source: input.source,
      path: input.path,
      userId: input.userId,
      ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
      scope,
      importBatchId,
      dryRun,
      parsed: ir.facts.length,
      created: 0,
      updated: 0,
      skipped: 0,
      mergedIntoExisting: 0,
      secretsSkipped: 0,
      failed: 0,
      links: { resolved: 0, deferred: 0, dangling: 0 },
      secrets: [],
      embeddingCostEstimate: {
        calls: 0,
        approxTokens: 0,
        approxUsd: 0,
        model: input.model ?? 'text-embedding-3-small',
      },
      advisories: [],
    };
  }
}

interface ScannedFact {
  fact: ImportedFact;
  content: string;
  skip: boolean;
  embeddingExcluded: boolean;
  extraTags: string[];
}
