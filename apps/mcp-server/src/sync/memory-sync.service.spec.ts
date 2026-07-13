import { MemorySyncService, type SyncSpec } from './memory-sync.service';
import type {
  ImportLedgerService,
  ImportSummary,
  LedgerEntry,
  MemoryImportService,
} from '@engram/memory-import';
import type { PrismaService } from '@engram/database';

const SUMMARY = {
  created: 1,
  updated: 0,
  skipped: 0,
  skippedConcurrentEdit: 0,
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
    contentHash: 'hash',
    importBatchId: 'batch',
    importedAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    lastWrittenVersion: null,
    ...overrides,
  };
}

interface Mocks {
  run: jest.Mock;
  listByUser: jest.Mock;
  findMany: jest.Mock;
  service: MemorySyncService;
}

function build(entries: LedgerEntry[], memoryUpdatedAt: Date | null): Mocks {
  const run = jest.fn().mockResolvedValue(SUMMARY);
  const listByUser = jest.fn().mockResolvedValue(entries);
  const findMany = jest
    .fn()
    .mockResolvedValue(
      memoryUpdatedAt
        ? entries.map((e) => ({ id: e.memoryId, updatedAt: memoryUpdatedAt }))
        : [],
    );
  const service = new MemorySyncService(
    { run } as unknown as MemoryImportService,
    { listByUser } as unknown as ImportLedgerService,
    { memory: { findMany } } as unknown as PrismaService,
  );
  return { run, listByUser, findMany, service };
}

const SPEC: SyncSpec = {
  source: 'claude-code',
  root: '/repo',
  userId: 'qp',
  scope: 'project:engram',
};

describe('MemorySyncService', () => {
  it('runs the WP4 importer with the right input when there are no conflicts', async () => {
    const { run, service } = build([], null);
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
    const { run, service } = build(
      [ledgerEntry()],
      new Date('2026-07-10T00:00:00.000Z'),
    );
    const result = await service.syncSource(SPEC);

    expect(result.skipped).toBe(true);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.memoryId).toBe('m1');
    expect(run).not.toHaveBeenCalled();
  });

  it('imports anyway when force is set, despite a conflict', async () => {
    const { run, service } = build(
      [ledgerEntry()],
      new Date('2026-07-10T00:00:00.000Z'),
    );
    const result = await service.syncSource(SPEC, { force: true });

    expect(result.skipped).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not flag a conflict when the memory is unchanged since import', async () => {
    const { run, service } = build(
      [ledgerEntry()],
      new Date('2026-07-01T00:00:00.000Z'),
    );
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
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { id: 'm1', updatedAt: new Date('2026-07-01T00:00:00.000Z') },
      ]);
    const run = jest.fn().mockResolvedValue(SUMMARY);
    const service = new MemorySyncService(
      { run } as unknown as MemoryImportService,
      {
        listByUser: jest.fn().mockResolvedValue(entries),
      } as unknown as ImportLedgerService,
      { memory: { findMany } } as unknown as PrismaService,
    );

    const result = await service.syncSource(SPEC);
    expect(result.skipped).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    // one batched query, scoped to only the claude-code memory id (codex 'other' excluded)
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]![0].where.id.in).toEqual(['m1']);
  });

  it('omits scope and embed from the import input when not provided', async () => {
    const { run, service } = build([], null);
    await service.syncSource({ source: 'gemini', root: '/repo', userId: 'qp' });
    expect(run).toHaveBeenCalledWith({
      source: 'gemini',
      path: '/repo',
      userId: 'qp',
    });
  });
});
