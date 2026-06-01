import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '@engram/redis';
import type { ReindexOptions, ReindexSummary } from './memory.service';
import { MemoryService } from './memory.service';

export type ReindexJobState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ReindexTerminalReason =
  | 'completed_success'
  | 'cancelled_before_start'
  | 'cancelled_by_request'
  | 'failed_runtime';

export interface ReindexJobAuditEvent {
  at: string;
  type:
    | 'job_enqueued'
    | 'job_started'
    | 'job_progress'
    | 'cancellation_requested'
    | 'job_cancelled'
    | 'job_completed'
    | 'job_failed'
    | 'job_retried';
  state: ReindexJobState;
  detail?: string;
}

export interface ReindexJobStatus {
  jobId: string;
  state: ReindexJobState;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  cancelRequested?: boolean;
  retryOfJobId?: string;
  terminalReason?: ReindexTerminalReason;
  events: ReindexJobAuditEvent[];
  options: ReindexOptions;
  summary: {
    processed: number;
    indexed: number;
    skipped: number;
    failed: number;
    cursor: string | null;
  };
}

const JOB_TTL_SECONDS = 60 * 60 * 24;

@Injectable()
export class ReindexQueueService {
  private readonly logger = new Logger(ReindexQueueService.name);
  private processingChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly redis: RedisService,
    private readonly memoryService: MemoryService,
  ) {}

  async enqueue(options: ReindexOptions): Promise<ReindexJobStatus> {
    return await this.enqueueInternal(options);
  }

  async cancel(jobId: string): Promise<ReindexJobStatus | null> {
    const job = await this.get(jobId);
    if (!job) {
      return null;
    }

    if (job.state === 'queued') {
      const cancelled = this.withEvent(
        {
          ...job,
          state: 'cancelled',
          terminalReason: 'cancelled_before_start',
          completedAt: new Date().toISOString(),
        },
        {
          type: 'job_cancelled',
          detail: 'Cancelled while queued',
        },
      );
      await this.save(cancelled);
      return cancelled;
    }

    if (job.state === 'running') {
      const marked = this.withEvent(
        {
          ...job,
          cancelRequested: true,
        },
        {
          type: 'cancellation_requested',
          detail: 'Cancellation requested for running job',
        },
      );
      await this.save(marked);
      return marked;
    }

    return job;
  }

  async retry(jobId: string): Promise<ReindexJobStatus | null> {
    const job = await this.get(jobId);
    if (!job) {
      return null;
    }

    if (job.state !== 'failed' && job.state !== 'cancelled') {
      return job;
    }

    const retried = await this.enqueueInternal(
      {
        ...job.options,
        cursor: job.summary.cursor ?? undefined,
      },
      job.jobId,
    );
    const retriedWithEvent = this.withEvent(retried, {
      type: 'job_retried',
      detail: `Retry requested from ${job.jobId}`,
    });
    await this.save(retriedWithEvent);
    return retriedWithEvent;
  }

  private async enqueueInternal(
    options: ReindexOptions,
    retryOfJobId?: string,
  ): Promise<ReindexJobStatus> {
    const jobId = randomUUID();
    const job: ReindexJobStatus = {
      jobId,
      state: 'queued',
      createdAt: new Date().toISOString(),
      retryOfJobId,
      events: [],
      options,
      summary: {
        processed: 0,
        indexed: 0,
        skipped: 0,
        failed: 0,
        cursor: options.cursor ?? null,
      },
    };

    const queued = this.withEvent(job, {
      type: 'job_enqueued',
      detail: retryOfJobId
        ? `Enqueued retry of ${retryOfJobId}`
        : 'Enqueued new reindex job',
    });
    await this.save(queued);

    this.processingChain = this.processingChain
      .then(async () => this.process(jobId))
      .catch((error: unknown) => {
        this.logger.error(
          `Unexpected queue-chain error for job ${jobId}: ${String(error)}`,
        );
      });

    return queued;
  }

  async get(jobId: string): Promise<ReindexJobStatus | null> {
    const raw = await this.redis.get(this.key(jobId));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as ReindexJobStatus;
  }

  private async process(jobId: string): Promise<void> {
    const initial = await this.get(jobId);
    if (!initial) {
      return;
    }

    if (initial.state === 'cancelled') {
      return;
    }

    let current = this.withEvent(
      {
        ...initial,
        state: 'running',
        startedAt: new Date().toISOString(),
      },
      {
        type: 'job_started',
        detail: 'Worker started processing job',
      },
    );
    await this.save(current);

    try {
      let cursor = current.summary.cursor;
      let remaining = current.options.maxMemories;
      const batchSize = current.options.batchSize ?? 100;

      for (;;) {
        const latest = await this.get(jobId);
        if (!latest) {
          return;
        }
        if (latest.state === 'cancelled' || latest.cancelRequested) {
          const cancelled = this.withEvent(
            {
              ...latest,
              state: 'cancelled',
              terminalReason: 'cancelled_by_request',
              completedAt: new Date().toISOString(),
            },
            {
              type: 'job_cancelled',
              detail: 'Cancelled while running',
            },
          );
          await this.save(cancelled);
          return;
        }

        if (remaining !== undefined && remaining <= 0) {
          break;
        }

        const maxMemories =
          remaining !== undefined ? Math.min(remaining, batchSize) : batchSize;

        const summary: ReindexSummary = await this.memoryService.reindex({
          ...current.options,
          cursor: cursor ?? undefined,
          maxMemories,
          batchSize,
        });

        cursor = summary.cursor;
        remaining =
          remaining !== undefined
            ? Math.max(0, remaining - summary.processed)
            : undefined;

        current = {
          ...current,
          summary: {
            processed: current.summary.processed + summary.processed,
            indexed: current.summary.indexed + summary.indexed,
            skipped: current.summary.skipped + summary.skipped,
            failed: current.summary.failed + summary.failed,
            cursor,
          },
        };
        current = this.withEvent(current, {
          type: 'job_progress',
          detail:
            `processed=${current.summary.processed} indexed=${current.summary.indexed} ` +
            `skipped=${current.summary.skipped} failed=${current.summary.failed} ` +
            `cursor=${current.summary.cursor ?? 'null'}`,
        });
        await this.save(current);

        if (!cursor || summary.processed === 0) {
          break;
        }
      }

      const completed = this.withEvent(
        {
          ...current,
          state: 'completed',
          terminalReason: 'completed_success',
          completedAt: new Date().toISOString(),
        },
        {
          type: 'job_completed',
          detail: 'Reindex job completed successfully',
        },
      );
      await this.save(completed);
    } catch (error) {
      const failed = this.withEvent(
        {
          ...current,
          state: 'failed',
          terminalReason: 'failed_runtime',
          completedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        },
        {
          type: 'job_failed',
          detail: error instanceof Error ? error.message : String(error),
        },
      );
      await this.save(failed);
    }
  }

  private withEvent(
    job: ReindexJobStatus,
    event: Omit<ReindexJobAuditEvent, 'at' | 'state'>,
  ): ReindexJobStatus {
    const stamped: ReindexJobAuditEvent = {
      ...event,
      at: new Date().toISOString(),
      state: job.state,
    };
    return {
      ...job,
      events: [...job.events, stamped],
    };
  }

  private async save(job: ReindexJobStatus): Promise<void> {
    await this.redis.set(
      this.key(job.jobId),
      JSON.stringify(job),
      JOB_TTL_SECONDS,
    );
  }

  private key(jobId: string): string {
    return `memory:reindex:job:${jobId}`;
  }
}
