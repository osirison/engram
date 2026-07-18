import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { STM_PROVIDER } from '@engram/memory-stm';

const JOB_NAME = 'stm_expiry_sweep';
const DEFAULT_INTERVAL_MS = 600_000; // 10 minutes

/** The subset of the STM provider surface the sweep needs. Only the
 * Postgres adapter implements it — the in-process adapter expires entries
 * via timers, so the sweep silently no-ops there. */
interface SweepableStmProvider {
  sweepExpired?: () => Promise<number>;
}

/**
 * Periodic hygiene job that bulk-deletes expired short-term memory rows.
 *
 * Correctness never depends on this: every STM read filters on
 * `expiresAt > now()`. The sweep only keeps the `memories` table from
 * accumulating dead rows. Interval via `STM_SWEEP_INTERVAL_MS`
 * (default 10 minutes; 0 disables the scheduler).
 */
@Injectable()
export class StmSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StmSweepService.name);
  private readonly intervalMs: number;

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    @Optional()
    @Inject(STM_PROVIDER)
    private readonly stmProvider?: SweepableStmProvider,
  ) {
    const parsed = Number(
      process.env.STM_SWEEP_INTERVAL_MS ?? DEFAULT_INTERVAL_MS,
    );
    this.intervalMs =
      Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_INTERVAL_MS;
  }

  onModuleInit(): void {
    if (this.intervalMs <= 0) {
      this.logger.log('STM sweep scheduler disabled (STM_SWEEP_INTERVAL_MS=0)');
      return;
    }
    if (typeof this.stmProvider?.sweepExpired !== 'function') {
      this.logger.log(
        'STM provider has no sweepExpired; sweep scheduler not started',
      );
      return;
    }
    const handle = setInterval(() => {
      void this.run().catch((error: unknown) =>
        this.logger.error('Scheduled STM sweep failed:', error),
      );
    }, this.intervalMs);
    this.schedulerRegistry.addInterval(JOB_NAME, handle);
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', JOB_NAME)) {
      this.schedulerRegistry.deleteInterval(JOB_NAME);
    }
  }

  async run(): Promise<number> {
    if (typeof this.stmProvider?.sweepExpired !== 'function') {
      return 0;
    }
    return await this.stmProvider.sweepExpired();
  }
}
