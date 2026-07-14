import {
  type ReindexJobStatus,
  ReindexQueueService,
} from './reindex-queue.service';

describe('ReindexQueueService', () => {
  const redis = {
    set: jest.fn<Promise<void>, [string, string, number]>(),
    get: jest.fn<Promise<string | null>, [string]>(),
  };

  const memoryService = {
    reindex: jest.fn(),
    recreateVectorIndex: jest.fn<Promise<void>, []>(),
  };

  let service: ReindexQueueService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReindexQueueService(redis as never, memoryService as never);
  });

  it('queues a job and persists queued state', async () => {
    redis.get.mockResolvedValue(null);

    const job = await service.enqueue({ batchSize: 100 });

    expect(job.state).toBe('queued');
    expect(job.jobId).toBeDefined();
    expect(job.events[0]?.type).toBe('job_enqueued');
    expect(redis.set).toHaveBeenCalled();
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

    let latest: ReindexJobStatus | null = null;
    redis.set.mockImplementation((_key, value) => {
      latest = JSON.parse(value) as ReindexJobStatus;
      return Promise.resolve();
    });
    redis.get.mockImplementation(() => {
      return Promise.resolve(latest ? JSON.stringify(latest) : null);
    });

    const job = await service.enqueue({ batchSize: 2 });
    // Allow the async chain to run.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

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

  const wireRedis = (): { current: () => ReindexJobStatus | null } => {
    let latest: ReindexJobStatus | null = null;
    redis.set.mockImplementation((_key, value) => {
      latest = JSON.parse(value) as ReindexJobStatus;
      return Promise.resolve();
    });
    redis.get.mockImplementation(() =>
      Promise.resolve(latest ? JSON.stringify(latest) : null),
    );
    return { current: () => latest };
  };

  const flush = async (): Promise<void> => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };

  it('recreates the vector index exactly once at the start of a full recreate job', async () => {
    memoryService.reindex.mockResolvedValue({
      processed: 1,
      indexed: 1,
      skipped: 0,
      failed: 0,
      cursor: null,
    });
    wireRedis();

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
    wireRedis();

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

  it('does not re-recreate the vector index for a resumed recreate job', async () => {
    memoryService.reindex.mockResolvedValue({
      processed: 1,
      indexed: 1,
      skipped: 0,
      failed: 0,
      cursor: null,
    });
    wireRedis();

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
    let latest: ReindexJobStatus | null = null;
    redis.set.mockImplementation((_key, value) => {
      latest = JSON.parse(value) as ReindexJobStatus;
      return Promise.resolve();
    });
    redis.get.mockImplementation(() => {
      return Promise.resolve(latest ? JSON.stringify(latest) : null);
    });

    const job = await service.enqueue({ batchSize: 2 });
    const cancelled = await service.cancel(job.jobId);

    expect(cancelled?.state).toBe('cancelled');
    expect(cancelled?.terminalReason).toBe('cancelled_before_start');
    expect(cancelled?.events.at(-1)?.type).toBe('job_cancelled');
  });

  it('returns null when getting a non-existent job', async () => {
    redis.get.mockResolvedValue(null);

    const result = await service.get('non-existent-job');

    expect(result).toBeNull();
  });

  it('flags a running job for cancellation without terminating it immediately', async () => {
    const runningJob: ReindexJobStatus = {
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
    };
    redis.get.mockResolvedValue(JSON.stringify(runningJob));
    redis.set.mockResolvedValue(undefined);

    const result = await service.cancel('job-running');

    expect(result?.cancelRequested).toBe(true);
    expect(result?.state).toBe('running');
    expect(result?.events.at(-1)?.type).toBe('cancellation_requested');
  });

  it('returns the job as-is when cancelling an already-completed job', async () => {
    const completedJob: ReindexJobStatus = {
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
    };
    redis.get.mockResolvedValue(JSON.stringify(completedJob));

    const result = await service.cancel('job-done');

    expect(result?.state).toBe('completed');
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('returns the job as-is when retrying a job that is not failed or cancelled', async () => {
    const runningJob: ReindexJobStatus = {
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
    };
    redis.get.mockResolvedValue(JSON.stringify(runningJob));

    const result = await service.retry('job-running');

    expect(result?.state).toBe('running');
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('marks job as failed when reindex throws a runtime error', async () => {
    memoryService.reindex.mockRejectedValue(
      new Error('embedding service unavailable'),
    );

    let latest: ReindexJobStatus | null = null;
    redis.set.mockImplementation((_key, value) => {
      latest = JSON.parse(value) as ReindexJobStatus;
      return Promise.resolve();
    });
    redis.get.mockImplementation(() => {
      return Promise.resolve(latest ? JSON.stringify(latest) : null);
    });

    const job = await service.enqueue({ batchSize: 10 });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const status = await service.get(job.jobId);
    expect(status?.state).toBe('failed');
    expect(status?.terminalReason).toBe('failed_runtime');
    expect(status?.error).toContain('embedding service unavailable');
    expect(status?.events.at(-1)?.type).toBe('job_failed');
  });

  it('skips processing if job was cancelled before the worker starts', async () => {
    let latest: ReindexJobStatus | null = null;
    redis.set.mockImplementation((_key, value) => {
      latest = JSON.parse(value) as ReindexJobStatus;
      return Promise.resolve();
    });
    redis.get.mockImplementation(() => {
      return Promise.resolve(latest ? JSON.stringify(latest) : null);
    });

    const job = await service.enqueue({ batchSize: 10 });
    await service.cancel(job.jobId);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const status = await service.get(job.jobId);
    expect(status?.state).toBe('cancelled');
    expect(memoryService.reindex).not.toHaveBeenCalled();
  });

  it('retries failed jobs from their cursor', async () => {
    const jobs = new Map<string, ReindexJobStatus>();
    redis.set.mockImplementation((key, value) => {
      jobs.set(key, JSON.parse(value) as ReindexJobStatus);
      return Promise.resolve();
    });
    redis.get.mockImplementation((key) => {
      const value = jobs.get(key);
      return Promise.resolve(value ? JSON.stringify(value) : null);
    });

    const failed: ReindexJobStatus = {
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
    };
    jobs.set('memory:reindex:job:job-failed', failed);

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
