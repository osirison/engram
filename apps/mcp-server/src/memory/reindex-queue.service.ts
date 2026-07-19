import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@engram/database';
import type { Prisma } from '@prisma/client';
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
    private readonly prisma: PrismaService,
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
    await this.sweepExpired();
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
    const row = await this.prisma.reindexJob.findUnique({
      where: { id: jobId },
    });
    if (!row || row.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return row.payload as unknown as ReindexJobStatus;
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

      // `recreate` is a whole-index rebuild, so it must run exactly once at the
      // job level — never per batch. Each chunked reindex() below always passes
      // maxMemories, which trips the LTM recreate guard and would silently skip
      // the rebuild. Reset only for a fresh (cursor-less), unscoped (no userId)
      // job; a resumed job already has a cursor and must not re-wipe completed
      // progress. After resetting we strip `recreate` from the per-batch calls.
      if (current.options.recreate) {
        if (
          current.options.userId ||
          current.options.maxMemories !== undefined
        ) {
          // A scoped (userId) or capped (maxMemories) job would drop the whole
          // index but only restore its own slice, breaking recall for everything
          // outside it. Mirror the LTM guard: recreate is unsafe for either.
          this.logger.warn(
            'Ignoring recreate: the vector index may only be rebuilt by an unscoped full reindex (no userId or maxMemories)',
          );
        } else if (cursor) {
          this.logger.log(
            `Skipping recreate for resumed job ${jobId}: the vector index was already reset when the job first started`,
          );
        } else {
          this.logger.log(
            `Recreating vector index for job ${jobId} (recall is unavailable until the rebuild completes)`,
          );
          await this.memoryService.recreateVectorIndex();
        }
      }

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
          // Handled once at the job level above; leaving it on would make every
          // chunked batch log "Ignoring recreate" and re-trip the LTM guard.
          recreate: false,
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
    // Every save extends the row's life by the TTL, matching the Redis
    // SET-with-TTL semantics this replaced. `payload` is the whole status
    // blob; the row is the unit of persistence, not a queue.
    const expiresAt = new Date(Date.now() + JOB_TTL_SECONDS * 1000);
    // JSON round-trip: Prisma Json inputs reject `undefined` values, and
    // optional fields (retryOfJobId, startedAt, ...) are routinely present as
    // undefined on the in-memory object. Stringify drops those keys.
    const payload = JSON.parse(JSON.stringify(job)) as Prisma.InputJsonValue;
    await this.prisma.reindexJob.upsert({
      where: { id: job.jobId },
      create: { id: job.jobId, payload, expiresAt },
      update: { payload, expiresAt },
    });
  }

  /** Lazily drop expired job rows; called on enqueue so cleanup frequency is
   * bounded by job creation, not by a scheduler. */
  private async sweepExpired(): Promise<void> {
    try {
      await this.prisma.reindexJob.deleteMany({
        where: { expiresAt: { lte: new Date() } },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to sweep expired reindex jobs: ${String(error)}`,
      );
    }
  }
}
