import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LtmMemoryQuotaExceededError } from '@engram/memory-ltm';

/**
 * Stand-in for memory-ltm's `LtmVersionConflictError` (not re-exported from the
 * package index). The import service matches the error by NAME — same contract
 * as memory.controller's `CONFLICT:` mapping — so a name-faithful double is the
 * honest way to drive the CAS-miss path.
 */
class VersionConflictError extends Error {
  constructor(
    memoryId: string,
    readonly currentVersion: number
  ) {
    super(`Long-term memory ${memoryId} was modified (currentVersion=${currentVersion})`);
    this.name = 'LtmVersionConflictError';
  }
}
import { MemoryImportService, type ImportRunInput } from './memory-import.service.js';
import { ImportSecretPolicyError, SecretScanner } from './secrets/secret-scanner.js';
import { computeContentHash } from './content-hash.js';
import type { ImportIR, ImportedFact } from './ir/types.js';
import type { SourceAdapter } from './ir/source-adapter.interface.js';

function fact(over: Partial<ImportedFact> & { sourceKey: string; content: string }): ImportedFact {
  return {
    localId: over.sourceKey,
    sourceTool: 'markdown',
    sourcePath: `${over.sourceKey.split(':')[1]}`,
    tags: ['markdown'],
    links: [],
    ...over,
  };
}

function makeIR(facts: ImportedFact[]): ImportIR {
  return {
    sourceTool: 'markdown',
    rootPath: '/vault',
    facts,
    provenance: {
      importedAt: '2026-07-06T00:00:00.000Z',
      importBatchId: 'b1',
      adapterVersion: '1',
    },
  };
}

/** Adapter stub returning a fixed IR. */
function stubAdapter(ir: ImportIR): SourceAdapter {
  return { tool: 'markdown', detect: async () => true, parse: async () => ir };
}

/** In-memory ledger double. */
function makeLedger(
  seed: Array<{
    sourceKey: string;
    memoryId: string;
    contentHash: string;
    lastWrittenVersion?: number | null;
  }> = []
) {
  const rows = new Map(seed.map((s) => [s.sourceKey, s]));
  return {
    rows,
    find: vi.fn(async (_u: string, k: string) => {
      const r = rows.get(k);
      return r
        ? {
            userId: 'qp',
            sourceTool: 'markdown',
            sourcePath: k,
            importBatchId: 'old',
            importedAt: new Date(),
            updatedAt: new Date(),
            id: k,
            lastWrittenVersion: null,
            ...r,
          }
        : null;
    }),
    findByContentHash: vi.fn(async () => [] as unknown[]),
    upsert: vi.fn(
      async (e: {
        sourceKey: string;
        memoryId: string;
        contentHash: string;
        lastWrittenVersion?: number;
      }) => {
        rows.set(e.sourceKey, { lastWrittenVersion: null, ...e });
        return { ...e };
      }
    ),
  };
}

function makeLtm() {
  let n = 0;
  return {
    create: vi.fn(async (input: { content: string }) => ({
      id: `mem-${++n}`,
      content: input.content,
      metadata: {},
      version: 1,
    })),
    update: vi.fn(async (_u: string, id: string) => ({
      id,
      content: '',
      metadata: {},
      version: 2,
    })),
  };
}

function makeResolver() {
  return {
    resolveBatch: vi.fn(async () => ({ resolved: 0, deferred: 0, total: 0 })),
    resolveDeferred: vi.fn(async () => 0),
  };
}

function build(ir: ImportIR, ledger: unknown, ltm: unknown, resolver: unknown) {
  const registry = new Map([['markdown', stubAdapter(ir)]]);
  return new MemoryImportService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ltm as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ledger as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver as any,
    new SecretScanner(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registry as any
  );
}

const baseInput: ImportRunInput = { source: 'markdown', path: '/vault', userId: 'qp' };

describe('MemoryImportService.run', () => {
  let ltm: ReturnType<typeof makeLtm>;
  let resolver: ReturnType<typeof makeResolver>;
  beforeEach(() => {
    ltm = makeLtm();
    resolver = makeResolver();
  });

  it('happy path: creates a memory + ledger row per new fact and resolves links', async () => {
    const ir = makeIR([
      fact({ sourceKey: 'markdown:a.md', content: 'Alpha note' }),
      fact({ sourceKey: 'markdown:b.md', content: 'Beta note' }),
    ]);
    const ledger = makeLedger();
    const summary = await build(ir, ledger, ltm, resolver).run(baseInput);
    expect(summary.created).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(ltm.create).toHaveBeenCalledTimes(2);
    expect(ledger.upsert).toHaveBeenCalledTimes(2);
    expect(resolver.resolveBatch).toHaveBeenCalledOnce();
    expect(summary.scope).toBe('import');
  });

  it('re-run is a no-op: ledger hits with unchanged hash → all skipped, no writes', async () => {
    const ir = makeIR([fact({ sourceKey: 'markdown:a.md', content: 'Alpha note' })]);
    const ledger = makeLedger([
      {
        sourceKey: 'markdown:a.md',
        memoryId: 'mem-1',
        contentHash: computeContentHash('Alpha note'),
      },
    ]);
    const summary = await build(ir, ledger, ltm, resolver).run(baseInput);
    expect(summary.skipped).toBe(1);
    expect(summary.created).toBe(0);
    expect(ltm.create).not.toHaveBeenCalled();
    expect(ltm.update).not.toHaveBeenCalled();
  });

  it('drift: ledger hit with a changed hash → updates the mapped memory', async () => {
    const ir = makeIR([fact({ sourceKey: 'markdown:a.md', content: 'Alpha note EDITED' })]);
    const ledger = makeLedger([
      {
        sourceKey: 'markdown:a.md',
        memoryId: 'mem-1',
        contentHash: computeContentHash('Alpha note'),
      },
    ]);
    const summary = await build(ir, ledger, ltm, resolver).run(baseInput);
    expect(summary.updated).toBe(1);
    expect(summary.created).toBe(0);
    expect(ltm.update).toHaveBeenCalledOnce();
  });

  it('cross-source merge: byte-identical content already imported → mergedIntoExisting + provenance append', async () => {
    const ir = makeIR([
      fact({ sourceKey: 'cursor:x.mdc', content: 'Shared rule', sourceTool: 'markdown' }),
    ]);
    const ledger = makeLedger();
    ledger.findByContentHash.mockResolvedValue([
      { memoryId: 'mem-existing', sourceKey: 'claude-code:memory/x.md' },
    ]);
    ltm.create.mockResolvedValue({
      id: 'mem-existing',
      content: 'Shared rule',
      metadata: { provenance: { sources: [{ sourceKey: 'claude-code:memory/x.md' }] } },
    });
    const summary = await build(ir, ledger, ltm, resolver).run(baseInput);
    expect(summary.mergedIntoExisting).toBe(1);
    expect(summary.created).toBe(0);
    expect(ltm.update).toHaveBeenCalledOnce(); // appended the new source to provenance
  });

  it('secret skip policy: a fact carrying a secret is dropped, not persisted', async () => {
    const ir = makeIR([
      fact({ sourceKey: 'markdown:clean.md', content: 'nothing secret here' }),
      fact({ sourceKey: 'markdown:leak.md', content: 'aws key AKIAIOSFODNN7EXAMPLE in here' }),
    ]);
    const summary = await build(ir, makeLedger(), ltm, resolver).run({
      ...baseInput,
      secretsPolicy: 'skip',
    });
    expect(summary.secretsSkipped).toBe(1);
    expect(summary.created).toBe(1);
    expect(summary.secrets.some((s) => s.path === 'leak.md')).toBe(true);
  });

  it('quota exceeded mid-run: stops gracefully with a resumable cursor', async () => {
    const ir = makeIR([
      fact({ sourceKey: 'markdown:a.md', content: 'Alpha' }),
      fact({ sourceKey: 'markdown:b.md', content: 'Beta' }),
      fact({ sourceKey: 'markdown:c.md', content: 'Gamma' }),
    ]);
    ltm.create
      .mockResolvedValueOnce({ id: 'mem-1', content: 'Alpha', metadata: {} })
      .mockRejectedValueOnce(new LtmMemoryQuotaExceededError('qp', 1));
    const summary = await build(ir, makeLedger(), ltm, resolver).run(baseInput);
    expect(summary.created).toBe(1);
    expect(summary.cursor).toBe(1);
    expect(summary.advisories.join(' ')).toMatch(/quota/i);
  });

  it('dry run: parses + estimates cost but writes nothing', async () => {
    const ir = makeIR([
      fact({ sourceKey: 'markdown:a.md', content: 'Alpha note with some words' }),
    ]);
    const ledger = makeLedger();
    const summary = await build(ir, ledger, ltm, resolver).run({ ...baseInput, dryRun: true });
    expect(summary.dryRun).toBe(true);
    expect(summary.parsed).toBe(1);
    expect(ltm.create).not.toHaveBeenCalled();
    expect(ledger.upsert).not.toHaveBeenCalled();
    expect(resolver.resolveBatch).not.toHaveBeenCalled();
    expect(summary.embeddingCostEstimate.calls).toBe(1);
    expect(summary.embeddingCostEstimate.approxTokens).toBeGreaterThan(0);
  });

  it('dry-run cost excludes flag-policy embeddingExcluded facts (matches the real run)', async () => {
    const ir = makeIR([
      fact({ sourceKey: 'markdown:clean.md', content: 'an ordinary note about coffee and books' }),
      fact({ sourceKey: 'markdown:leak.md', content: 'aws key AKIAIOSFODNN7EXAMPLE in here' }),
    ]);
    const summary = await build(ir, makeLedger(), ltm, resolver).run({
      ...baseInput,
      dryRun: true,
      secretsPolicy: 'flag',
    });
    // Under `flag` nothing is skipped, but the flagged fact is embedding-excluded,
    // so the dry-run estimate must count only the clean fact — exactly what the
    // real run's finalizeEmbeddingAdvice would embed. (Previously it counted both.)
    expect(summary.secretsSkipped).toBe(0);
    expect(summary.embeddingCostEstimate.calls).toBe(1);
    expect(summary.secrets.some((s) => s.path === 'leak.md')).toBe(true);
  });

  it('flag policy: persists redacted content and marks the row embeddingExcluded', async () => {
    const ir = makeIR([
      fact({ sourceKey: 'markdown:leak.md', content: 'aws key AKIAIOSFODNN7EXAMPLE in here' }),
    ]);
    await build(ir, makeLedger(), ltm, resolver).run({ ...baseInput, secretsPolicy: 'flag' });

    expect(ltm.create).toHaveBeenCalledTimes(1);
    const created = ltm.create.mock.calls[0][0] as {
      content: string;
      metadata?: Record<string, unknown>;
    };
    // Decision 3: no raw secret is persisted under flag...
    expect(created.content).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(created.content).toContain('[REDACTED]');
    // ...and the row is held out of the embedding index (enforced by ltm.create).
    expect(created.metadata?.embeddingExcluded).toBe(true);
  });

  it('unknown source: throws a clear error', async () => {
    const svc = build(makeIR([]), makeLedger(), ltm, resolver);
    await expect(svc.run({ ...baseInput, source: 'codex' })).rejects.toThrow(/No import adapter/);
  });

  describe('frontmatter/title secrets (G2-T2)', () => {
    const dirtyFrontmatter = () => ({
      description: 'token ghp_1234567890abcdefghijklmnopqrstuvwxyzAB here',
      nested: { hosts: ['10.0.0.5', 'example.com'], port: 5432 },
      alwaysApply: true,
    });

    function dirtyIR() {
      return makeIR([
        fact({
          sourceKey: 'markdown:leaky.md',
          content: 'clean body about deploys',
          title: 'rotate AKIAIOSFODNN7EXAMPLE monthly',
          frontmatter: dirtyFrontmatter(),
        }),
      ]);
    }

    function createdArg(index = 0) {
      return ltm.create.mock.calls[index]?.[0] as unknown as {
        content: string;
        metadata?: Record<string, unknown>;
        tags?: string[];
      };
    }

    it('redact: stores sanitized title + frontmatter, structure and non-strings intact', async () => {
      const summary = await build(dirtyIR(), makeLedger(), ltm, resolver).run(baseInput);
      const created = createdArg();
      expect(JSON.stringify(created)).not.toMatch(
        /ghp_1234567890|AKIAIOSFODNN7EXAMPLE|10\.0\.0\.5/
      );
      expect(created.metadata?.['title']).toBe('rotate [REDACTED] monthly');
      expect(created.metadata?.['frontmatter']).toEqual({
        description: 'token [REDACTED] here',
        nested: { hosts: ['[REDACTED]', 'example.com'], port: 5432 },
        alwaysApply: true,
      });
      expect(summary.secrets).toEqual([
        { path: 'leaky.md', patterns: expect.arrayContaining(['aws-key', 'github-token']) },
      ]);
    });

    it('flag: a frontmatter-only hit redacts, embedding-excludes, and tags has-secret', async () => {
      const ir = makeIR([
        fact({
          sourceKey: 'markdown:fm-only.md',
          content: 'clean body',
          frontmatter: { description: 'DB_PASSWORD=s3cr3tvalue' },
        }),
      ]);
      await build(ir, makeLedger(), ltm, resolver).run({ ...baseInput, secretsPolicy: 'flag' });
      const created = createdArg();
      expect(created.content).toBe('clean body');
      expect(created.metadata?.['embeddingExcluded']).toBe(true);
      expect(created.tags).toContain('has-secret');
      expect(JSON.stringify(created.metadata?.['frontmatter'])).not.toContain('s3cr3tvalue');
    });

    it('skip: a title-only hit drops the whole fact', async () => {
      const ir = makeIR([
        fact({ sourceKey: 'markdown:t.md', content: 'clean body', title: 'ssn 123-45-6789' }),
      ]);
      const summary = await build(ir, makeLedger(), ltm, resolver).run({
        ...baseInput,
        secretsPolicy: 'skip',
      });
      expect(summary.secretsSkipped).toBe(1);
      expect(ltm.create).not.toHaveBeenCalled();
    });

    it('fail: a frontmatter hit aborts, naming the surface', async () => {
      const svc = build(dirtyIR(), makeLedger(), ltm, resolver);
      const promise = svc.run({ ...baseInput, secretsPolicy: 'fail' });
      await expect(promise).rejects.toBeInstanceOf(ImportSecretPolicyError);
      await expect(promise).rejects.toThrow(/in title, frontmatter/);
      expect(ltm.create).not.toHaveBeenCalled();
    });

    it('dry run reports frontmatter/title hits identically to a real run', async () => {
      const svc = build(dirtyIR(), makeLedger(), ltm, resolver);
      const dry = await svc.run({ ...baseInput, dryRun: true, secretsPolicy: 'skip' });
      expect(ltm.create).not.toHaveBeenCalled();
      const real = await svc.run({ ...baseInput, secretsPolicy: 'skip' });
      expect(dry.secretsSkipped).toBe(real.secretsSkipped);
      expect(dry.secrets).toEqual(real.secrets);
      expect(dry.embeddingCostEstimate).toEqual(real.embeddingCostEstimate);
    });
  });

  describe('import-vs-agent-edit CAS-skip (G4-T3 / Decision 13)', () => {
    const seeded = (lastWrittenVersion?: number | null) => [
      {
        sourceKey: 'markdown:a.md',
        memoryId: 'mem-1',
        contentHash: computeContentHash('Alpha note'),
        ...(lastWrittenVersion !== undefined ? { lastWrittenVersion } : {}),
      },
    ];
    const driftedIR = () => makeIR([fact({ sourceKey: 'markdown:a.md', content: 'Alpha EDITED' })]);

    it('passes the ledger lastWrittenVersion as expectedVersion on a drift update', async () => {
      const ledger = makeLedger(seeded(4));
      ltm.update.mockResolvedValue({ id: 'mem-1', content: '', metadata: {}, version: 5 });
      const summary = await build(driftedIR(), ledger, ltm, resolver).run(baseInput);
      expect(summary.updated).toBe(1);
      expect(summary.skippedConcurrentEdit).toBe(0);
      const updateInput = ltm.update.mock.calls[0]?.[2] as { expectedVersion?: number };
      expect(updateInput.expectedVersion).toBe(4);
      // The ledger records the version the update produced, arming the next CAS.
      expect(ledger.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ sourceKey: 'markdown:a.md', lastWrittenVersion: 5 })
      );
    });

    it('CAS miss → skippedConcurrentEdit, ledger row untouched, run continues', async () => {
      const ir = makeIR([
        fact({ sourceKey: 'markdown:a.md', content: 'Alpha EDITED' }),
        fact({ sourceKey: 'markdown:b.md', content: 'Beta note' }),
      ]);
      const ledger = makeLedger(seeded(4));
      ltm.update.mockRejectedValue(new VersionConflictError('mem-1', 6));
      const summary = await build(ir, ledger, ltm, resolver).run(baseInput);

      expect(summary.skippedConcurrentEdit).toBe(1);
      expect(summary.updated).toBe(0);
      expect(summary.failed).toBe(0); // a CAS skip is NOT a failure
      expect(summary.created).toBe(1); // the run continued with the other fact
      // Ledger hash + version stay stale so the next run retries/re-reports.
      expect(ledger.upsert).toHaveBeenCalledTimes(1);
      expect(ledger.upsert).not.toHaveBeenCalledWith(
        expect.objectContaining({ sourceKey: 'markdown:a.md' })
      );
      // The skipped fact is not link-resolved (its content was not imported).
      const batchArg = resolver.resolveBatch.mock.calls[0]?.[0] as {
        facts: Array<{ memoryId: string }>;
      };
      expect(batchArg.facts).toHaveLength(1);
    });

    it('NULL ledger version (pre-upgrade row) → no expectedVersion, one last LWW, backfills', async () => {
      const ledger = makeLedger(seeded(null));
      ltm.update.mockResolvedValue({ id: 'mem-1', content: '', metadata: {}, version: 9 });
      const summary = await build(driftedIR(), ledger, ltm, resolver).run(baseInput);
      expect(summary.updated).toBe(1);
      const updateInput = ltm.update.mock.calls[0]?.[2] as Record<string, unknown>;
      expect('expectedVersion' in updateInput).toBe(false);
      // Backfill: the version written by the LWW update is now in the ledger.
      expect(ledger.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ sourceKey: 'markdown:a.md', lastWrittenVersion: 9 })
      );
    });

    it('create path records the created row version in the ledger', async () => {
      const ledger = makeLedger();
      const ir = makeIR([fact({ sourceKey: 'markdown:new.md', content: 'Brand new' })]);
      await build(ir, ledger, ltm, resolver).run(baseInput);
      expect(ledger.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ sourceKey: 'markdown:new.md', lastWrittenVersion: 1 })
      );
    });

    it('merge path records the post-provenance-append version in the ledger', async () => {
      const ir = makeIR([fact({ sourceKey: 'cursor:x.mdc', content: 'Shared rule' })]);
      const ledger = makeLedger();
      ledger.findByContentHash.mockResolvedValue([
        { memoryId: 'mem-existing', sourceKey: 'claude-code:memory/x.md' },
      ]);
      ltm.create.mockResolvedValue({
        id: 'mem-existing',
        content: 'Shared rule',
        metadata: { provenance: { sources: [{ sourceKey: 'claude-code:memory/x.md' }] } },
        version: 3,
      });
      ltm.update.mockResolvedValue({ id: 'mem-existing', content: '', metadata: {}, version: 4 });
      const summary = await build(ir, ledger, ltm, resolver).run(baseInput);
      expect(summary.mergedIntoExisting).toBe(1);
      expect(ledger.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ sourceKey: 'cursor:x.mdc', lastWrittenVersion: 4 })
      );
    });
  });

  describe('acceptance (plan G4-T3): agent edit between imports wins', () => {
    /** Stateful LTM fake enforcing the real version-CAS contract of update(). */
    function makeVersionedLtm() {
      const store = new Map<
        string,
        {
          id: string;
          content: string;
          tags: string[];
          metadata: Record<string, unknown>;
          version: number;
        }
      >();
      let n = 0;
      return {
        store,
        create: vi.fn(
          async (input: {
            content: string;
            tags?: string[];
            metadata?: Record<string, unknown>;
          }) => {
            const row = {
              id: `mem-${++n}`,
              content: input.content,
              tags: input.tags ?? [],
              metadata: input.metadata ?? {},
              version: 1,
            };
            store.set(row.id, row);
            return { ...row };
          }
        ),
        update: vi.fn(
          async (
            _u: string,
            id: string,
            input: {
              content?: string;
              tags?: string[];
              metadataMerge?: Record<string, unknown>;
              expectedVersion?: number;
            }
          ) => {
            const row = store.get(id);
            if (!row) throw new Error(`not found: ${id}`);
            if (input.expectedVersion !== undefined && input.expectedVersion !== row.version) {
              throw new VersionConflictError(id, row.version);
            }
            if (input.content !== undefined) row.content = input.content;
            if (input.tags !== undefined) row.tags = input.tags;
            if (input.metadataMerge !== undefined)
              row.metadata = { ...row.metadata, ...input.metadataMerge };
            row.version += 1;
            return { ...row };
          }
        ),
        /** Out-of-band ENGRAM edit (simulates an agent's update_memory). */
        agentEdit(id: string, content: string): void {
          const row = store.get(id);
          if (!row) throw new Error(`not found: ${id}`);
          row.content = content;
          row.version += 1;
        },
      };
    }

    it('seeds via import, bumps version out-of-band, re-imports → agent content kept, skippedConcurrentEdit=1', async () => {
      const versionedLtm = makeVersionedLtm();
      const ledger = makeLedger();

      // Run 1: first import of the source file.
      const run1 = await build(
        makeIR([fact({ sourceKey: 'markdown:a.md', content: 'Fact v1 from source' })]),
        ledger,
        versionedLtm,
        resolver
      ).run(baseInput);
      expect(run1.created).toBe(1);
      const memoryId = [...versionedLtm.store.keys()][0]!;
      expect(ledger.rows.get('markdown:a.md')).toMatchObject({ lastWrittenVersion: 1 });

      // Out-of-band agent edit inside ENGRAM: version 1 → 2.
      versionedLtm.agentEdit(memoryId, 'Agent-improved fact');

      // Run 2: the source file changed too → drift update → CAS miss → skip.
      const run2 = await build(
        makeIR([fact({ sourceKey: 'markdown:a.md', content: 'Fact v2 from source' })]),
        ledger,
        versionedLtm,
        resolver
      ).run(baseInput);
      expect(run2.skippedConcurrentEdit).toBe(1);
      expect(run2.updated).toBe(0);
      expect(run2.failed).toBe(0);
      // The memory keeps the agent's content — never clobbered by the source.
      expect(versionedLtm.store.get(memoryId)?.content).toBe('Agent-improved fact');
      // Ledger still points at the ORIGINAL import (hash + version stale).
      expect(ledger.rows.get('markdown:a.md')).toMatchObject({
        contentHash: computeContentHash('Fact v1 from source'),
        lastWrittenVersion: 1,
      });

      // Run 3: same changed source again → still skips (persistent until the
      // operator reconciles — documented behavior, not a transient miss).
      const run3 = await build(
        makeIR([fact({ sourceKey: 'markdown:a.md', content: 'Fact v2 from source' })]),
        ledger,
        versionedLtm,
        resolver
      ).run(baseInput);
      expect(run3.skippedConcurrentEdit).toBe(1);
      expect(versionedLtm.store.get(memoryId)?.content).toBe('Agent-improved fact');
    });
  });
});
