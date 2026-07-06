import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ImportLedgerService, type UpsertLedgerInput } from './import-ledger.service.js';

function makeRow(over: Partial<Record<string, unknown>> = {}) {
  const now = new Date('2026-07-06T00:00:00.000Z');
  return {
    id: 'ledger1',
    userId: 'qp',
    memoryId: 'mem1',
    sourceTool: 'claude-code',
    sourcePath: 'memory/feedback-worktree.md',
    sourceKey: 'claude-code:memory/feedback-worktree.md',
    contentHash: 'hash-a',
    importBatchId: 'batch1',
    importedAt: now,
    updatedAt: now,
    ...over,
  };
}

describe('ImportLedgerService', () => {
  let prisma: {
    memoryImportSource: {
      findUnique: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
  };
  let service: ImportLedgerService;

  beforeEach(() => {
    prisma = {
      memoryImportSource: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new ImportLedgerService(prisma as any);
  });

  it('find() does a single indexed lookup on the composite unique key', async () => {
    prisma.memoryImportSource.findUnique.mockResolvedValue(makeRow());
    const entry = await service.find('qp', 'claude-code:memory/feedback-worktree.md');
    expect(prisma.memoryImportSource.findUnique).toHaveBeenCalledOnce();
    expect(prisma.memoryImportSource.findUnique).toHaveBeenCalledWith({
      where: {
        userId_sourceKey: { userId: 'qp', sourceKey: 'claude-code:memory/feedback-worktree.md' },
      },
    });
    expect(entry?.sourceTool).toBe('claude-code');
  });

  it('find() returns null for an unknown source key', async () => {
    prisma.memoryImportSource.findUnique.mockResolvedValue(null);
    expect(await service.find('qp', 'missing')).toBeNull();
  });

  const upsertInput: UpsertLedgerInput = {
    userId: 'qp',
    memoryId: 'mem1',
    sourceTool: 'claude-code',
    sourcePath: 'memory/feedback-worktree.md',
    sourceKey: 'claude-code:memory/feedback-worktree.md',
    contentHash: 'hash-a',
    importBatchId: 'batch1',
  };

  it('upsert() records a first import (create branch)', async () => {
    prisma.memoryImportSource.upsert.mockResolvedValue(makeRow());
    await service.upsert(upsertInput);
    const call = prisma.memoryImportSource.upsert.mock.calls[0]?.[0];
    expect(call.where).toEqual({
      userId_sourceKey: { userId: 'qp', sourceKey: 'claude-code:memory/feedback-worktree.md' },
    });
    expect(call.create.contentHash).toBe('hash-a');
    expect(call.update.contentHash).toBe('hash-a');
    // sourceKey is immutable on update (it is the identity) — not in the update payload.
    expect(call.update.sourceKey).toBeUndefined();
  });

  it('upsert() refreshes contentHash + memoryId + batch on hash drift (update branch)', async () => {
    prisma.memoryImportSource.upsert.mockResolvedValue(
      makeRow({ contentHash: 'hash-b', memoryId: 'mem2', importBatchId: 'batch2' })
    );
    const entry = await service.upsert({
      ...upsertInput,
      contentHash: 'hash-b',
      memoryId: 'mem2',
      importBatchId: 'batch2',
    });
    const call = prisma.memoryImportSource.upsert.mock.calls[0]?.[0];
    expect(call.update).toMatchObject({
      contentHash: 'hash-b',
      memoryId: 'mem2',
      importBatchId: 'batch2',
    });
    expect(entry.contentHash).toBe('hash-b');
  });

  it('findByContentHash() queries by (userId, contentHash)', async () => {
    prisma.memoryImportSource.findMany.mockResolvedValue([makeRow()]);
    const rows = await service.findByContentHash('qp', 'hash-a');
    expect(prisma.memoryImportSource.findMany).toHaveBeenCalledWith({
      where: { userId: 'qp', contentHash: 'hash-a' },
    });
    expect(rows).toHaveLength(1);
  });

  it('listBatch() returns all rows for an import batch', async () => {
    prisma.memoryImportSource.findMany.mockResolvedValue([makeRow(), makeRow({ id: 'ledger2' })]);
    const rows = await service.listBatch('batch1');
    expect(prisma.memoryImportSource.findMany).toHaveBeenCalledWith({
      where: { importBatchId: 'batch1' },
    });
    expect(rows.map((r) => r.id)).toEqual(['ledger1', 'ledger2']);
  });
});
