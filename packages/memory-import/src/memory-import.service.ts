// Import pipeline core (WP4 §T3 / D1). Turns an adapter's ImportIR into
// persisted, deduped, provenance-tracked long-term memories + resolved links —
// idempotently. Does NOT reimplement dedup/embedding: it computes a sourceKey +
// contentHash, consults the ledger, and delegates to MemoryLtmService.create()/
// update() (whose exact-content dedup + semantic dup/contradiction it inherits).

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { resolveEmbeddingRuntime } from '@engram/embeddings';
import { MemoryLtmService, LtmMemoryQuotaExceededError, type LtmMemory } from '@engram/memory-ltm';
import { ImportLedgerService } from './ledger/import-ledger.service.js';
import { namespaceSourceKey } from './ledger/source-key.js';
import { LinkResolver, type ResolverFact } from './links/link-resolver.service.js';
import { SecretScanner, type SecretPolicy } from './secrets/secret-scanner.js';
import {
  estimateEmbeddingCost,
  EMBEDDING_USD_PER_MILLION,
  type CostEstimate,
} from './embedding/cost-estimator.js';
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
  /**
   * Re-imports skipped because the memory was edited inside ENGRAM since the
   * last import (version CAS miss — G4-T3 CAS-skip, ADR
   * `docs/concurrency-policy.md` Decision 13). The agent edit is kept; the
   * ledger hash is left stale so every following run re-reports the conflict
   * until the operator reconciles.
   */
  skippedConcurrentEdit: number;
  /**
   * CAS-missed re-imports whose file content turned out to EQUAL the memory's
   * current content — the operator aligned the two sides, so the importer
   * adopted the memory's version/hash into the ledger (no memory write) and the
   * conflict is cleared instead of being re-reported forever.
   */
  reconciled: number;
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

/** Input for a persistence-free sanitized parse (`parseFacts`). */
export interface ParseFactsInput {
  source: SourceTool;
  /** Server-side path the selected adapter parses. */
  path: string;
  /** Sanitization policy for the returned contents (default `redact`). */
  secretsPolicy?: SecretPolicy;
  splitHeadings?: boolean;
  includeGlobal?: boolean;
}

/**
 * One parsed, SANITIZED fact as the sync bridge sees it (WP5 T11 / #239) —
 * no database access, nothing persisted.
 */
export interface ParsedSyncFact {
  /** Root-namespaced ledger key (#236) — matches `memory_import_sources.sourceKey`. */
  ledgerKey: string;
  /** Bare adapter key (`<tool>:<relpath>[#anchor]`) — matches pre-namespacing rows. */
  sourceKey: string;
  sourcePath: string;
  anchor?: string;
  /** Sanitized under `secretsPolicy` — safe to persist (never raw file bytes). */
  content: string;
  contentHash: string;
  tags: string[];
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
    const scanned = this.scanFacts(ir, secretsPolicy, summary.secrets);

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
          if (entry.frontmatter !== undefined) rf.frontmatter = entry.frontmatter;
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

  /**
   * Persistence-free sanitized parse (WP5 T11 / #239). Runs the source adapter
   * and the secret scan exactly as `run()` would, then returns the facts
   * WITHOUT touching the database — the sync bridge uses this to obtain the
   * file's version of a conflicted fact for the `conflict`-tagged review copy.
   * Facts dropped by the `skip` policy are excluded (never surface a secret).
   */
  async parseFacts(input: ParseFactsInput): Promise<ParsedSyncFact[]> {
    const adapter = this.registry?.get(input.source);
    if (!adapter) {
      throw new Error(`No import adapter registered for source '${input.source}'`);
    }
    const ir = await adapter.parse(input.path, {
      importBatchId: `parse-${randomUUID()}`,
      importedAt: new Date().toISOString(),
      ...(input.splitHeadings !== undefined ? { splitHeadings: input.splitHeadings } : {}),
      ...(input.includeGlobal !== undefined ? { includeGlobal: input.includeGlobal } : {}),
    });
    const scanned = this.scanFacts(ir, input.secretsPolicy ?? 'redact', []);
    return scanned
      .filter((s) => !s.skip)
      .map((s) => ({
        ledgerKey: namespaceSourceKey(s.fact.sourceKey, ir.rootPath),
        sourceKey: s.fact.sourceKey,
        sourcePath: s.fact.sourcePath,
        ...(s.fact.anchor !== undefined ? { anchor: s.fact.anchor } : {}),
        content: s.content,
        contentHash: computeContentHash(s.content),
        tags: [...new Set([...s.fact.tags, ...s.extraTags])],
      }));
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
    const { fact, content, extraTags } = entry;
    const userId = summary.userId;
    const contentHash = computeContentHash(content);
    // #236: the ledger key is the adapter's bare key namespaced with a stable
    // fingerprint of the import root, so two roots sharing a relpath (two
    // repos each with a CLAUDE.md) hit distinct ledger rows instead of
    // thrashing on one shared row. See ledger/source-key.ts for the design.
    const ledgerKey = namespaceSourceKey(fact.sourceKey, ir.rootPath);
    let existing = await this.ledger.find(userId, ledgerKey);
    if (!existing) {
      // Compat path (#236): rows written before namespacing live under the
      // bare adapter key. Claim + rename that row in place (one-time upgrade)
      // so this re-import keeps updating the SAME memory — no duplicate is
      // created and hash-based idempotency is preserved. If the rename loses
      // a race, re-probe the namespaced key the winner wrote.
      const legacy = await this.ledger.find(userId, fact.sourceKey);
      if (legacy) {
        existing =
          (await this.ledger.migrateKey(userId, fact.sourceKey, ledgerKey)) ??
          (await this.ledger.find(userId, ledgerKey));
        if (existing) {
          this.logger.log(
            `Ledger key migrated to root namespace: '${fact.sourceKey}' → '${ledgerKey}'`
          );
        }
      }
    }

    if (existing && existing.contentHash === contentHash) {
      summary.skipped++;
      return existing.memoryId; // idempotent no-op; links still re-ensured
    }

    const source: ProvenanceSource = {
      sourceTool: ir.sourceTool,
      sourcePath: fact.sourcePath,
      sourceKey: ledgerKey,
    };
    const tags = [...new Set([...fact.tags, ...extraTags])];

    let memoryId: string;
    /** `Memory.version` after this import's write — recorded in the ledger (G4-T3). */
    let writtenVersion: number | undefined;
    if (existing) {
      // Ledger hit, hash changed → update the mapped memory (re-embeds, merges
      // meta) under the CAS-skip policy (G4-T3 / Decision 13, ADR
      // docs/concurrency-policy.md): pass the version this importer last wrote
      // as expectedVersion so a concurrent ENGRAM edit makes the CAS miss and
      // the source file NEVER clobbers the agent's edit.
      //
      // NULL fallback: ledger rows written before `lastWrittenVersion` existed
      // carry NULL — no CAS is possible for that first re-import, so it is one
      // last last-writer-wins update, and the version it writes backfills the
      // ledger; every later re-import CASes normally.
      const expected = existing.lastWrittenVersion;
      const meta = this.buildMetadata(entry, importBatchId, importedAt, ir, contentHash, [source]);
      let updated: LtmMemory;
      try {
        updated = await this.ltm.update(
          userId,
          existing.memoryId,
          {
            content,
            tags,
            metadataMerge: meta,
            ...(typeof expected === 'number' ? { expectedVersion: expected } : {}),
          },
          summary.organizationId,
          scope
        );
      } catch (err) {
        if (isLtmVersionConflict(err)) {
          // Convergence check (#239 reconciliation): when the file content now
          // EQUALS the memory's current content, the operator has aligned the
          // two sides — adopt the memory's version + the file hash into the
          // ledger (no memory write) so the conflict CLEARS instead of being
          // re-reported forever. This is the documented "align the source file
          // with the ENGRAM edit" reconcile path, made effective.
          const current = await Promise.resolve()
            .then(() => this.ltm.get(userId, existing.memoryId, summary.organizationId, scope))
            .catch(() => null);
          if (current && computeContentHash(current.content) === contentHash) {
            await this.ledger.upsert({
              userId,
              memoryId: existing.memoryId,
              sourceTool: ir.sourceTool,
              sourcePath: fact.sourcePath,
              sourceKey: ledgerKey,
              contentHash,
              importBatchId,
              lastWrittenVersion: current.version,
            });
            summary.reconciled++;
            this.logger.log(
              `Reconciled ${ledgerKey}: file content matches memory ${existing.memoryId} ` +
                `(v${current.version}) — ledger refreshed, conflict cleared`
            );
            return existing.memoryId;
          }
          // CAS miss → SKIP: keep the agent's content, count it for the
          // operator, and deliberately leave the ledger row (hash + version)
          // untouched so the next run retries and re-reports the conflict.
          summary.skippedConcurrentEdit++;
          this.logger.warn(
            `Concurrent ENGRAM edit on memory ${existing.memoryId} (${ledgerKey}): ` +
              `last imported at v${expected ?? '?'}, now v${err.currentVersion ?? '?'} — ` +
              `skipping re-import (CAS-skip); reconcile in ENGRAM or update the source file`
          );
          return null;
        }
        throw err;
      }
      memoryId = updated.id;
      writtenVersion = updated.version;
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
        metadata: this.buildMetadata(entry, importBatchId, importedAt, ir, contentHash, [source]),
      });
      memoryId = created.id;
      if (priorSameContent.length > 0) {
        summary.mergedIntoExisting++;
        // The provenance append bumps the version — record the post-append one.
        writtenVersion = await this.appendProvenanceSource(created, source, scope, summary);
      } else {
        summary.created++;
        writtenVersion = created.version;
      }
    }

    await this.ledger.upsert({
      userId,
      memoryId,
      sourceTool: ir.sourceTool,
      sourcePath: fact.sourcePath,
      sourceKey: ledgerKey,
      contentHash,
      importBatchId,
      ...(typeof writtenVersion === 'number' ? { lastWrittenVersion: writtenVersion } : {}),
    });
    return memoryId;
  }

  /**
   * Append this source to a merged memory's `provenance.sources[]` (D1).
   * Returns the memory's `version` after the append (the append is a version
   * bump) — the value the ledger must record as `lastWrittenVersion` (G4-T3).
   */
  private async appendProvenanceSource(
    memory: LtmMemory,
    source: ProvenanceSource,
    scope: string,
    summary: ImportSummary
  ): Promise<number> {
    const meta = (memory.metadata ?? {}) as Record<string, unknown>;
    const prov = (meta['provenance'] ?? {}) as Record<string, unknown>;
    const existingSources = Array.isArray(prov['sources'])
      ? (prov['sources'] as ProvenanceSource[])
      : [];
    if (existingSources.some((s) => s.sourceKey === source.sourceKey)) return memory.version;
    const sources = [...existingSources, source];
    const updated = await this.ltm.update(
      summary.userId,
      memory.id,
      { metadataMerge: { provenance: { ...prov, sources } } },
      summary.organizationId,
      scope
    );
    return updated.version;
  }

  private buildMetadata(
    entry: ScannedFact,
    importBatchId: string,
    importedAt: string,
    ir: ImportIR,
    contentHash: string,
    sources: ProvenanceSource[]
  ): Record<string, unknown> {
    const { fact } = entry;
    const metadata: Record<string, unknown> = {
      provenance: {
        sourceTool: ir.sourceTool,
        sourcePath: fact.sourcePath,
        // Root-namespaced (#236) — matches the ledger row for this fact.
        sourceKey: sources[0]?.sourceKey ?? fact.sourceKey,
        importedAt,
        importBatchId,
        contentHash,
        adapterVersion: ir.provenance.adapterVersion,
        sources,
      },
    };
    // Persist the SANITIZED title/frontmatter from the secret scan (G2-T2) —
    // never fact.title / fact.frontmatter verbatim.
    if (entry.frontmatter !== undefined) metadata['frontmatter'] = entry.frontmatter;
    if (entry.title !== undefined) metadata['title'] = entry.title;
    if (entry.embeddingExcluded) metadata['embeddingExcluded'] = true;
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

  private scanFacts(
    ir: ImportIR,
    policy: SecretPolicy,
    secretsOut: Array<{ path: string; patterns: string[] }>
  ): ScannedFact[] {
    const out: ScannedFact[] = [];
    for (const fact of ir.facts) {
      // `fail` throws ImportSecretPolicyError up to run()'s caller (aborts).
      // Title + frontmatter are scanned under the same policy as content (G2-T2).
      const result = this.secrets.apply(
        {
          content: fact.content,
          sourcePath: fact.sourcePath,
          ...(fact.title !== undefined ? { title: fact.title } : {}),
          ...(fact.frontmatter !== undefined ? { frontmatter: fact.frontmatter } : {}),
        },
        policy
      );
      if (result.matches.length > 0) {
        secretsOut.push({
          path: fact.sourcePath,
          patterns: result.matches.map((m) => m.pattern),
        });
      }
      out.push({
        fact,
        content: result.content,
        ...(result.title !== undefined ? { title: result.title } : {}),
        ...(result.frontmatter !== undefined ? { frontmatter: result.frontmatter } : {}),
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

  /**
   * Resolve the cost-estimate options from the caller's explicit model or the
   * process-wide embedding runtime. Models missing from the pricing table
   * estimate at $0 when the active provider is not OpenAI — local models have
   * no per-token API cost, and defaulting them to an OpenAI rate would inflate
   * dry-run budgets.
   */
  private estimateOptions(model?: string): { model: string; usdPerMillion?: number } {
    const runtime = resolveEmbeddingRuntime();
    const effectiveModel = model ?? runtime.model;
    if (EMBEDDING_USD_PER_MILLION[effectiveModel] === undefined && runtime.provider !== 'openai') {
      return { model: effectiveModel, usdPerMillion: 0 };
    }
    return { model: effectiveModel };
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
      this.estimateOptions(model)
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
      this.estimateOptions(model)
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
      skippedConcurrentEdit: 0,
      reconciled: 0,
      mergedIntoExisting: 0,
      secretsSkipped: 0,
      failed: 0,
      links: { resolved: 0, deferred: 0, dangling: 0 },
      secrets: [],
      embeddingCostEstimate: {
        calls: 0,
        approxTokens: 0,
        approxUsd: 0,
        model: this.estimateOptions(input.model).model,
      },
      advisories: [],
    };
  }
}

interface ScannedFact {
  fact: ImportedFact;
  /** Sanitized surfaces from the secret scan — persist these, never `fact.*`. */
  content: string;
  title?: string;
  frontmatter?: Record<string, unknown>;
  skip: boolean;
  embeddingExcluded: boolean;
  extraTags: string[];
}

/**
 * `LtmVersionConflictError` matched by NAME, mirroring the `CONFLICT:` mapping
 * in `memory.controller.ts` — avoids coupling to the class identity across the
 * package's src/dist module copies (an `instanceof` against a second copy of
 * the class silently never matches).
 */
function isLtmVersionConflict(err: unknown): err is Error & { currentVersion?: number } {
  return err instanceof Error && err.name === 'LtmVersionConflictError';
}
