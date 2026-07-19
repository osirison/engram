import {
  type ReindexJobStatus,
  ReindexQueueService,
} from './reindex-queue.service';

interface JobRow {
  id: string;
  payload: ReindexJobStatus;
  expiresAt: Date;
}

describe('ReindexQueueService', () => {
  // In-memory stand-in for the `reindex_jobs` table.
  const table = new Map<string, JobRow>();

  const prisma = {
    reindexJob: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(table.get(where.id) ?? null),
      ),
      upsert: jest.fn(
        ({
          where,
          create,
          update,
        }: {
          where: { id: string };
          create: JobRow;
          update: Omit<JobRow, 'id'>;
        }) => {
          const existing = table.get(where.id);
          const row = existing ? { ...existing, ...update } : { ...create };
          table.set(where.id, row);
          return Promise.resolve(row);
        },
      ),
      deleteMany: jest.fn(
        ({ where }: { where: { expiresAt: { lte: Date } } }) => {
          let count = 0;
          for (const [id, row] of table) {
            if (row.expiresAt <= where.expiresAt.lte) {
              table.delete(id);
              count += 1;
            }
          }
          return Promise.resolve({ count });
        },
      ),
    },
  };

  const memoryService = {
    reindex: jest.fn(),
    recreateVectorIndex: jest.fn<Promise<void>, []>(),
  };

  let service: ReindexQueueService;

  const seed = (payload: ReindexJobStatus, ttlMs = 60_000): void => {
    table.set(payload.jobId, {
      id: payload.jobId,
      payload,
      expiresAt: new Date(Date.now() + ttlMs),
    });
  };

  const flush = async (): Promise<void> => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    table.clear();
    service = new ReindexQueueService(prisma as never, memoryService as never);
  });

  it('queues a job and persists queued state', async () => {
    const job = await service.enqueue({ batchSize: 100 });

    expect(job.state).toBe('queued');
    expect(job.jobId).toBeDefined();
    expect(job.events[0]?.type).toBe('job_enqueued');
    expect(prisma.reindexJob.upsert).toHaveBeenCalled();
    expect(table.get(job.jobId)?.payload.state).toBe('queued');
  });

  it('persists payloads with undefined optional fields stripped (Prisma Json rejects undefined)', async () => {
    await service.enqueue({ batchSize: 1 });

    const { create } = prisma.reindexJob.upsert.mock
      .calls[0]![0] as unknown as {
      create: { payload: Record<string, unknown> };
    };
    // enqueue() without a retry sets retryOfJobId: undefined on the in-memory
    // object; the persisted payload must not carry the key at all.
    expect('retryOfJobId' in create.payload).toBe(false);
    expect(
      Object.values(create.payload).every((value) => value !== undefined),
    ).toBe(true);
  });

  it('sweeps expired job rows on enqueue', async () => {
    table.set('stale-job', {
      id: 'stale-job',
      payload: { jobId: 'stale-job' } as ReindexJobStatus,
      expiresAt: new Date(Date.now() - 1000),
    });

    await service.enqueue({ batchSize: 1 });
    await flush();

    expect(table.has('stale-job')).toBe(false);
  });

  it('treats an expired-but-unswept row as missing', async () => {
    seed(
      {
        jobId: 'job-expired',
        state: 'completed',
        createdAt: new Date().toISOString(),
        events: [],
        options: {},
        summary: {
          processed: 1,
          indexed: 1,
          skipped: 0,
          failed: 0,
          cursor: null,
        },
      },
      -1000,
    );

    await expect(service.get('job-expired')).resolves.toBeNull();
  });

  it('processes queued jobs and aggregates progress', async () => {
    memoryService.reindex
      .mockResolvedValueOnce({
        processed: 2,
        indexed: 2,
        skipped: 0,
        failed: 0,
        cursor: 'next-cursor',
      })
      .mockResolvedValueOnce({
        processed: 1,
        indexed: 1,
        skipped: 0,
        failed: 0,
        cursor: null,
      });

    const job = await service.enqueue({ batchSize: 2 });
    await flush();

    const status = await service.get(job.jobId);

    expect(status?.state).toBe('completed');
    expect(status?.terminalReason).toBe('completed_success');
    expect(status?.summary.processed).toBe(3);
    expect(status?.summary.indexed).toBe(3);
    expect(status?.events.some((event) => event.type === 'job_progress')).toBe(
      true,
    );
    expect(memoryService.reindex).toHaveBeenCalledTimes(2);
  });

  it('recreates the vector index exactly once at the start of a full recreate job', async () => {
    memoryService.reindex.mockResolvedValue({
      processed: 1,
      indexed: 1,
      skipped: 0,
      failed: 0,
      cursor: null,
    });

    const job = await service.enqueue({
      recreate: true,
      reuseExistingEmbeddings: false,
      batchSize: 2,
    });
    await flush();

    const status = await service.get(job.jobId);
    expect(status?.state).toBe('completed');
    // Rebuilt once, at the job level — not once per chunked batch.
    expect(memoryService.recreateVectorIndex).toHaveBeenCalledTimes(1);
    // The reset happens before the first batch is indexed (invocationCallOrder
    // is a global 1-based counter shared across mocks, so 0 means "never called").
    const recreateOrder =
      memoryService.recreateVectorIndex.mock.invocationCallOrder[0] ?? 0;
    const firstReindexOrder =
      memoryService.reindex.mock.invocationCallOrder[0] ?? 0;
    expect(recreateOrder).toBeGreaterThan(0);
    expect(firstReindexOrder).toBeGreaterThan(0);
    expect(recreateOrder).toBeLessThan(firstReindexOrder);
    // Per-batch reindex never re-triggers recreate (it would trip the LTM guard).
    expect(memoryService.reindex).toHaveBeenCalledWith(
      expect.objectContaining({ recreate: false }),
    );
  });

  it('does not recreate the vector index for a scoped (userId) recreate job', async () => {
    memoryService.reindex.mockResolvedValue({
      processed: 1,
      indexed: 1,
      skipped: 0,
      failed: 0,
      cursor: null,
    });

    const job = await service.enqueue({
      recreate: true,
      userId: 'user-1',
      batchSize: 2,
    });
    await flush();

    const status = await service.get(job.jobId);
    expect(status?.state).toBe('completed');
    expect(memoryService.recreateVectorIndex).not.toHaveBeenCalled();
    expect(memoryService.reindex).toHaveBeenCalled();
  });

  it('does not recreate the vector index for a capped (maxMemories) recreate job', async () => {
    memoryService.reindex.mockResolvedValue({
      processed: 1,
      indexed: 1,
      skipped: 0,
      failed: 0,
      cursor: null,
    });

    // A capped job restores only its own slice, so dropping the whole index
    // would strand every vector past the cap — recreate must be refused.
    const job = await service.enqueue({
      recreate: true,
      maxMemories: 5000,
      batchSize: 2,
    });
    await flush();

    const status = await service.get(job.jobId);
    expect(status?.state).toBe('completed');
    expect(memoryService.recreateVectorIndex).not.toHaveBeenCalled();
  });

  it('does not re-recreate the vector index for a resumed recreate job', async () => {
    memoryService.reindex.mockResolvedValue({
      processed: 1,
      indexed: 1,
      skipped: 0,
      failed: 0,
      cursor: null,
    });

    // A resumed/retried job re-enters processing with a cursor already set;
    // re-wiping here would discard the progress the first run completed.
    const job = await service.enqueue({
      recreate: true,
      cursor: 'resume-cursor',
      batchSize: 2,
    });
    await flush();

    const status = await service.get(job.jobId);
    expect(status?.state).toBe('completed');
    expect(memoryService.recreateVectorIndex).not.toHaveBeenCalled();
  });

  it('cancels queued jobs immediately', async () => {
    const job = await service.enqueue({ batchSize: 2 });
    const cancelled = await service.cancel(job.jobId);

    expect(cancelled?.state).toBe('cancelled');
    expect(cancelled?.terminalReason).toBe('cancelled_before_start');
    expect(cancelled?.events.at(-1)?.type).toBe('job_cancelled');
  });

  it('returns null when getting a non-existent job', async () => {
    await expect(service.get('non-existent-job')).resolves.toBeNull();
  });

  it('flags a running job for cancellation without terminating it immediately', async () => {
    seed({
      jobId: 'job-running',
      state: 'running',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      cancelRequested: false,
      events: [],
      options: { batchSize: 10 },
      summary: {
        processed: 2,
        indexed: 2,
        skipped: 0,
        failed: 0,
        cursor: 'c-2',
      },
    });

    const result = await service.cancel('job-running');

    expect(result?.cancelRequested).toBe(true);
    expect(result?.state).toBe('running');
    expect(result?.events.at(-1)?.type).toBe('cancellation_requested');
  });

  it('returns the job as-is when cancelling an already-completed job', async () => {
    seed({
      jobId: 'job-done',
      state: 'completed',
      createdAt: new Date().toISOString(),
      events: [],
      options: {},
      summary: {
        processed: 5,
        indexed: 5,
        skipped: 0,
        failed: 0,
        cursor: null,
      },
    });

    const result = await service.cancel('job-done');

    expect(result?.state).toBe('completed');
    expect(prisma.reindexJob.upsert).not.toHaveBeenCalled();
  });

  it('returns the job as-is when retrying a job that is not failed or cancelled', async () => {
    seed({
      jobId: 'job-running',
      state: 'running',
      createdAt: new Date().toISOString(),
      events: [],
      options: {},
      summary: {
        processed: 0,
        indexed: 0,
        skipped: 0,
        failed: 0,
        cursor: null,
      },
    });

    const result = await service.retry('job-running');

    expect(result?.state).toBe('running');
    expect(prisma.reindexJob.upsert).not.toHaveBeenCalled();
  });

  it('marks job as failed when reindex throws a runtime error', async () => {
    memoryService.reindex.mockRejectedValue(
      new Error('embedding service unavailable'),
    );

    const job = await service.enqueue({ batchSize: 10 });
    await flush();

    const status = await service.get(job.jobId);
    expect(status?.state).toBe('failed');
    expect(status?.terminalReason).toBe('failed_runtime');
    expect(status?.error).toContain('embedding service unavailable');
    expect(status?.events.at(-1)?.type).toBe('job_failed');
  });

  it('skips processing if job was cancelled before the worker starts', async () => {
    const job = await service.enqueue({ batchSize: 10 });
    await service.cancel(job.jobId);
    await flush();

    const status = await service.get(job.jobId);
    expect(status?.state).toBe('cancelled');
    expect(memoryService.reindex).not.toHaveBeenCalled();
  });

  it('retries failed jobs from their cursor', async () => {
    seed({
      jobId: 'job-failed',
      state: 'failed',
      createdAt: new Date().toISOString(),
      events: [],
      options: { batchSize: 10 },
      summary: {
        processed: 5,
        indexed: 5,
        skipped: 0,
        failed: 1,
        cursor: 'c-5',
      },
    });

    const retried = await service.retry('job-failed');

    expect(retried).toBeTruthy();
    expect(retried?.state).toBe('queued');
    expect(retried?.options.cursor).toBe('c-5');
    expect(retried?.retryOfJobId).toBe('job-failed');
    expect(retried?.events.some((event) => event.type === 'job_retried')).toBe(
      true,
    );
  });
});
