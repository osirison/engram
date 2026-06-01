import { ReindexQueueService } from './reindex-queue.service';

describe('ReindexQueueService', () => {
  const redis = {
    set: jest.fn<Promise<void>, [string, string, number]>(),
    get: jest.fn<Promise<string | null>, [string]>(),
  };

  const memoryService = {
    reindex: jest.fn(),
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

    let latest: Record<string, unknown> | null = null;
    redis.set.mockImplementation(async (_key, value) => {
      latest = JSON.parse(value);
    });
    redis.get.mockImplementation(async () =>
      latest ? JSON.stringify(latest) : null,
    );

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

  it('cancels queued jobs immediately', async () => {
    let latest: Record<string, unknown> | null = null;
    redis.set.mockImplementation(async (_key, value) => {
      latest = JSON.parse(value);
    });
    redis.get.mockImplementation(async () =>
      latest ? JSON.stringify(latest) : null,
    );

    const job = await service.enqueue({ batchSize: 2 });
    const cancelled = await service.cancel(job.jobId);

    expect(cancelled?.state).toBe('cancelled');
    expect(cancelled?.terminalReason).toBe('cancelled_before_start');
    expect(cancelled?.events.at(-1)?.type).toBe('job_cancelled');
  });

  it('retries failed jobs from their cursor', async () => {
    const jobs = new Map<string, Record<string, unknown>>();
    redis.set.mockImplementation(async (key, value) => {
      jobs.set(key, JSON.parse(value));
    });
    redis.get.mockImplementation(async (key) => {
      const value = jobs.get(key);
      return value ? JSON.stringify(value) : null;
    });

    const failed = {
      jobId: 'job-failed',
      state: 'failed',
      createdAt: new Date().toISOString(),
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
