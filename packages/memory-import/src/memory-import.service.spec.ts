import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LtmMemoryQuotaExceededError } from '@engram/memory-ltm';
import { MemoryImportService, type ImportRunInput } from './memory-import.service.js';
import { SecretScanner } from './secrets/secret-scanner.js';
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
  seed: Array<{ sourceKey: string; memoryId: string; contentHash: string }> = []
) {
  const rows = new Map(seed.map((s) => [s.sourceKey, s]));
  return {
    rows,
    find: vi.fn(async (_u: string, k: string) => {
      const r = rows.get(k);
      return r
        ? {
            ...r,
            userId: 'qp',
            sourceTool: 'markdown',
            sourcePath: k,
            importBatchId: 'old',
            importedAt: new Date(),
            updatedAt: new Date(),
            id: k,
          }
        : null;
    }),
    findByContentHash: vi.fn(async () => [] as unknown[]),
    upsert: vi.fn(async (e: { sourceKey: string; memoryId: string; contentHash: string }) => {
      rows.set(e.sourceKey, e);
      return { ...e };
    }),
  };
}

function makeLtm() {
  let n = 0;
  return {
    create: vi.fn(async (input: { content: string }) => ({
      id: `mem-${++n}`,
      content: input.content,
      metadata: {},
    })),
    update: vi.fn(async (_u: string, id: string) => ({ id, content: '', metadata: {} })),
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

  it('unknown source: throws a clear error', async () => {
    const svc = build(makeIR([]), makeLedger(), ltm, resolver);
    await expect(svc.run({ ...baseInput, source: 'codex' })).rejects.toThrow(/No import adapter/);
  });
});
