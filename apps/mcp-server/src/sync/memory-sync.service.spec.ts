import {
  CONFLICT_COPY_TAG,
  conflictCopyScope,
  MemorySyncService,
  type SyncSpec,
} from './memory-sync.service';
import {
  computeContentHash,
  type ImportLedgerService,
  type ImportSummary,
  type LedgerEntry,
  type MemoryImportService,
  type ParsedSyncFact,
} from '@engram/memory-import';
import type { MemoryLtmService } from '@engram/memory-ltm';
import type { PrismaService } from '@engram/database';

const SUMMARY = {
  created: 1,
  updated: 0,
  skipped: 0,
  skippedConcurrentEdit: 0,
  reconciled: 0,
  mergedIntoExisting: 0,
} as unknown as ImportSummary;

function ledgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: 'l1',
    userId: 'qp',
    memoryId: 'm1',
    sourceTool: 'claude-code',
    sourcePath: 'CLAUDE.md',
    sourceKey: 'claude-code:CLAUDE.md',
    contentHash: computeContentHash('imported v1'),
    importBatchId: 'batch',
    importedAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    lastWrittenVersion: null,
    ...overrides,
  };
}

function parsedFact(overrides: Partial<ParsedSyncFact> = {}): ParsedSyncFact {
  const content = overrides.content ?? 'file v2';
  return {
    ledgerKey: 'claude-code@abcdef012345:CLAUDE.md',
    sourceKey: 'claude-code:CLAUDE.md',
    sourcePath: 'CLAUDE.md',
    content,
    contentHash: computeContentHash(content),
    tags: ['claude-code'],
    ...overrides,
  };
}

interface MemoryRow {
  id: string;
  updatedAt: Date;
  content: string;
}

interface CopyRow {
  id: string;
  metadata: Record<string, unknown>;
}

interface BuildOpts {
  entries?: LedgerEntry[];
  /** Rows behind prisma.memory.findMany({ where: { id: { in } } }). */
  memories?: MemoryRow[];
  /** Facts returned by importService.parseFacts (the file's current state). */
  facts?: ParsedSyncFact[];
  /** Pre-existing conflict copies (tag-filtered findMany / findFirst). */
  copies?: CopyRow[];
}

interface Mocks {
  run: jest.Mock;
  parseFacts: jest.Mock;
  listByUser: jest.Mock;
  findMany: jest.Mock;
  findFirst: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  service: MemorySyncService;
}

function build(opts: BuildOpts = {}): Mocks {
  const { entries = [], memories = [], facts = [], copies = [] } = opts;
  const run = jest.fn().mockResolvedValue(SUMMARY);
  const parseFacts = jest.fn().mockResolvedValue(facts);
  const listByUser = jest.fn().mockResolvedValue(entries);
  const findMany = jest.fn(
    (args: {
      where: { id?: { in: string[] }; tags?: { has: string } };
      select?: Record<string, boolean>;
    }) => {
      if (args.where.tags) return Promise.resolve(copies);
      const ids = args.where.id?.in ?? [];
      return Promise.resolve(memories.filter((m) => ids.includes(m.id)));
    },
  );
  const findFirst = jest.fn(
    (args: { where: { metadata: { equals: unknown } } }) => {
      const contested = args.where.metadata.equals;
      const hit = copies.find(
        (c) =>
          (c.metadata['conflict'] as Record<string, unknown> | undefined)?.[
            'memoryId'
          ] === contested,
      );
      return Promise.resolve(hit ?? null);
    },
  );
  const create = jest.fn(
    (input: { metadata?: Record<string, unknown> }): Promise<unknown> =>
      Promise.resolve({ id: 'copy-new', metadata: input.metadata ?? {} }),
  );
  const update = jest.fn().mockResolvedValue({ id: 'copy-1' });
  const del = jest.fn().mockResolvedValue(true);
  const service = new MemorySyncService(
    { run, parseFacts } as unknown as MemoryImportService,
    { listByUser } as unknown as ImportLedgerService,
    { memory: { findMany, findFirst } } as unknown as PrismaService,
    { create, update, delete: del } as unknown as MemoryLtmService,
  );
  return {
    run,
    parseFacts,
    listByUser,
    findMany,
    findFirst,
    create,
    update,
    delete: del,
    service,
  };
}

const SPEC: SyncSpec = {
  source: 'claude-code',
  root: '/repo',
  userId: 'qp',
  scope: 'project:engram',
};

const EDITED_AT = new Date('2026-07-10T00:00:00.000Z');
const IMPORTED_AT = new Date('2026-07-01T00:00:00.000Z');

/** One contested memory: imported v1, edited in ENGRAM afterwards. */
function conflictedOpts(over: Partial<BuildOpts> = {}): BuildOpts {
  return {
    entries: [ledgerEntry()],
    memories: [{ id: 'm1', updatedAt: EDITED_AT, content: 'agent-edited' }],
    facts: [parsedFact()], // file moved to v2 → genuine divergence
    ...over,
  };
}

describe('MemorySyncService', () => {
  it('runs the WP4 importer with the right input when there are no conflicts', async () => {
    const { run, service } = build();
    const result = await service.syncSource(SPEC);

    expect(result.skipped).toBe(false);
    expect(result.summary).toBe(SUMMARY);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({
      source: 'claude-code',
      path: '/repo',
      userId: 'qp',
      scope: 'project:engram',
    });
  });

  it('skips the import (no clobber) when a memory was edited in ENGRAM after import', async () => {
    const { run, service } = build(conflictedOpts());
    const result = await service.syncSource(SPEC);

    expect(result.skipped).toBe(true);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.memoryId).toBe('m1');
    expect(run).not.toHaveBeenCalled();
  });

  it('imports anyway when force is set, despite a conflict', async () => {
    const { run, service } = build(conflictedOpts());
    const result = await service.syncSource(SPEC, { force: true });

    expect(result.skipped).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not flag a conflict when the memory is unchanged since import', async () => {
    const { run, service } = build({
      entries: [ledgerEntry()],
      memories: [{ id: 'm1', updatedAt: IMPORTED_AT, content: 'imported v1' }],
    });
    const result = await service.syncSource(SPEC);

    expect(result.skipped).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('ignores ledger entries for other sources when checking conflicts', async () => {
    // A codex memory is newer, but we are syncing claude-code — it must not block.
    const entries = [
      ledgerEntry({
        sourceTool: 'codex',
        memoryId: 'other',
        sourcePath: 'AGENTS.md',
      }),
      ledgerEntry(),
    ];
    const { run, findMany, service } = build({
      entries,
      memories: [{ id: 'm1', updatedAt: IMPORTED_AT, content: 'imported v1' }],
    });

    const result = await service.syncSource(SPEC);
    expect(result.skipped).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    // The conflict query is scoped to only the claude-code memory id ('other' excluded).
    const idQueries = findMany.mock.calls.filter((c) => c[0].where.id);
    expect(idQueries[0]![0].where.id.in).toEqual(['m1']);
  });

  it('omits scope and embed from the import input when not provided', async () => {
    const { run, service } = build();
    await service.syncSource({ source: 'gemini', root: '/repo', userId: 'qp' });
    expect(run).toHaveBeenCalledWith({
      source: 'gemini',
      path: '/repo',
      userId: 'qp',
    });
  });

  describe('D7 conflict copies (#239)', () => {
    it('stores the file version as a conflict-tagged copy; contested memory untouched', async () => {
      const { create, update, service } = build(conflictedOpts());
      const result = await service.syncSource(SPEC);

      expect(result.skipped).toBe(true);
      expect(result.conflictCopies.created).toBe(1);
      expect(create).toHaveBeenCalledTimes(1);
      const created = create.mock.calls[0]![0] as {
        content: string;
        tags: string[];
        scope: string;
        metadata: { conflict: Record<string, unknown> };
        skipDuplicateCheck?: boolean;
      };
      expect(created.content).toBe('file v2');
      expect(created.tags).toContain(CONFLICT_COPY_TAG);
      expect(created.scope).toBe(conflictCopyScope('m1'));
      expect(created.skipDuplicateCheck).toBe(true);
      // The review surface can find both sides through the metadata link.
      expect(created.metadata.conflict).toMatchObject({
        memoryId: 'm1',
        sourceKey: 'claude-code:CLAUDE.md',
        sourcePath: 'CLAUDE.md',
        sourceTool: 'claude-code',
        contentHash: computeContentHash('file v2'),
      });
      // The contested memory itself is never written.
      expect(update).not.toHaveBeenCalled();
    });

    it('gives each contested memory its own copy even when file contents are identical', async () => {
      // Two contested memories whose file versions are byte-identical: the
      // scope-bound exact dedup must not let m1's copy satisfy m2's create.
      const sameContent = 'shared instruction text';
      const { create, service } = build({
        entries: [
          ledgerEntry(),
          ledgerEntry({
            id: 'l2',
            memoryId: 'm2',
            sourcePath: 'AGENTS.md',
            sourceKey: 'claude-code:AGENTS.md',
          }),
        ],
        memories: [
          { id: 'm1', updatedAt: EDITED_AT, content: 'agent-edited 1' },
          { id: 'm2', updatedAt: EDITED_AT, content: 'agent-edited 2' },
        ],
        facts: [
          parsedFact({ content: sameContent }),
          parsedFact({
            content: sameContent,
            sourcePath: 'AGENTS.md',
            sourceKey: 'claude-code:AGENTS.md',
            ledgerKey: 'claude-code@abcdef012345:AGENTS.md',
          }),
        ],
      });
      const result = await service.syncSource(SPEC);

      expect(result.conflictCopies.created).toBe(2);
      expect(create).toHaveBeenCalledTimes(2);
      const scopes = create.mock.calls.map(
        (c) => (c[0] as { scope: string }).scope,
      );
      expect(scopes).toContain(conflictCopyScope('m1'));
      expect(scopes).toContain(conflictCopyScope('m2'));
    });

    it('matches conflicts by the root-namespaced ledger key too (#236)', async () => {
      const { create, service } = build(
        conflictedOpts({
          entries: [
            ledgerEntry({ sourceKey: 'claude-code@abcdef012345:CLAUDE.md' }),
          ],
        }),
      );
      const result = await service.syncSource(SPEC);
      expect(result.conflictCopies.created).toBe(1);
      expect(create).toHaveBeenCalledTimes(1);
    });

    it('is idempotent: a re-run over the same unresolved conflict creates no second copy', async () => {
      const { create, update, service } = build(
        conflictedOpts({
          copies: [
            {
              id: 'copy-1',
              metadata: {
                conflict: {
                  memoryId: 'm1',
                  contentHash: computeContentHash('file v2'),
                },
              },
            },
          ],
        }),
      );
      const result = await service.syncSource(SPEC);

      expect(result.conflictCopies.created).toBe(0);
      expect(result.conflictCopies.unchanged).toBe(1);
      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('refreshes the single copy in place when the file moves on (no pile-up)', async () => {
      const { create, update, service } = build(
        conflictedOpts({
          facts: [parsedFact({ content: 'file v3' })],
          copies: [
            {
              id: 'copy-1',
              metadata: {
                conflict: {
                  memoryId: 'm1',
                  contentHash: computeContentHash('file v2'),
                },
              },
            },
          ],
        }),
      );
      const result = await service.syncSource(SPEC);

      expect(result.conflictCopies.updated).toBe(1);
      expect(result.conflictCopies.created).toBe(0);
      expect(create).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledTimes(1);
      const [userId, copyId, input, , scope] = update.mock.calls[0]!;
      expect(userId).toBe('qp');
      expect(copyId).toBe('copy-1');
      expect((input as { content: string }).content).toBe('file v3');
      expect(scope).toBe(conflictCopyScope('m1'));
    });

    it('stores no copy for a memory-only edit (file still matches last import)', async () => {
      const { create, service } = build(
        conflictedOpts({ facts: [parsedFact({ content: 'imported v1' })] }),
      );
      const result = await service.syncSource(SPEC);

      expect(result.skipped).toBe(true); // conflict still defers the import
      expect(result.conflictCopies.created).toBe(0);
      expect(create).not.toHaveBeenCalled();
    });

    it('stores no copy when the file already matches the ENGRAM edit (hand-reconciled)', async () => {
      const { create, service } = build(
        conflictedOpts({ facts: [parsedFact({ content: 'agent-edited' })] }),
      );
      const result = await service.syncSource(SPEC);

      expect(result.conflictCopies.created).toBe(0);
      expect(create).not.toHaveBeenCalled();
    });

    it('survives a parse failure without breaking the skip path', async () => {
      const mocks = build(conflictedOpts());
      mocks.parseFacts.mockRejectedValue(new Error('boom'));
      const result = await mocks.service.syncSource(SPEC);

      expect(result.skipped).toBe(true);
      expect(result.conflictCopies).toEqual({
        created: 0,
        updated: 0,
        unchanged: 0,
        removedStale: 0,
      });
    });

    it('removes stale copies once the conflict is resolved (clean re-sync)', async () => {
      // No conflict anymore (memory not edited past the ledger), but a copy
      // from an earlier conflict lingers → the clean sync removes it.
      const { delete: del, service } = build({
        entries: [ledgerEntry()],
        memories: [
          { id: 'm1', updatedAt: IMPORTED_AT, content: 'imported v1' },
        ],
        copies: [
          {
            id: 'copy-stale',
            metadata: {
              conflict: { memoryId: 'm1', sourceTool: 'claude-code' },
            },
          },
        ],
      });
      const result = await service.syncSource(SPEC);

      expect(result.skipped).toBe(false);
      expect(result.conflictCopies.removedStale).toBe(1);
      expect(del).toHaveBeenCalledWith(
        'qp',
        'copy-stale',
        undefined,
        conflictCopyScope('m1'),
      );
    });

    it('keeps the copy when a forced sync leaves the conflict unresolved (CAS-skip)', async () => {
      // Forced import runs, but the row CAS-skips: memory stays newer than the
      // ledger → conflict persists post-run → the copy must NOT be deleted.
      const {
        delete: del,
        run,
        service,
      } = build(
        conflictedOpts({
          copies: [
            {
              id: 'copy-1',
              metadata: {
                conflict: {
                  memoryId: 'm1',
                  contentHash: computeContentHash('file v2'),
                },
              },
            },
          ],
        }),
      );
      run.mockResolvedValue({
        ...SUMMARY,
        skippedConcurrentEdit: 1,
      });
      const result = await service.syncSource(SPEC, { force: true });

      expect(result.skipped).toBe(false);
      expect(result.summary!.skippedConcurrentEdit).toBe(1); // G4-T3 composition
      expect(result.conflictCopies.removedStale).toBe(0);
      expect(del).not.toHaveBeenCalled();
    });
  });
});
