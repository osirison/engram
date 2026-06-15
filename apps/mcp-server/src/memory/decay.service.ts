import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { MemoryLtmService, type DecayPolicyResult } from '@engram/memory-ltm';

const JOB_NAME = 'ltm_decay';

@Injectable()
export class DecayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DecayService.name);
  private readonly intervalMs: number;

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    @Optional() private readonly ltmService?: MemoryLtmService,
  ) {
    const parsed = Number(process.env.MEMORY_DECAY_INTERVAL_MS ?? 86_400_000);
    this.intervalMs =
      Number.isFinite(parsed) && parsed >= 0 ? parsed : 86_400_000;
  }

  onModuleInit(): void {
    if (this.intervalMs <= 0) {
      this.logger.log('Decay scheduler disabled (MEMORY_DECAY_INTERVAL_MS=0)');
      return;
    }
    const handle = setInterval(() => {
      void this.run().catch((error: unknown) =>
        this.logger.error('Scheduled decay pass failed:', error),
      );
    }, this.intervalMs);
    this.schedulerRegistry.addInterval(JOB_NAME, handle);
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', JOB_NAME)) {
      this.schedulerRegistry.deleteInterval(JOB_NAME);
    }
  }

  async run(): Promise<DecayPolicyResult> {
    if (!this.ltmService) {
      this.logger.warn('DecayService: LTM service unavailable, skipping run');
      return { processed: 0, updated: 0, pruned: 0, stale: 0, cursor: null };
    }

    return await this.ltmService.applyDecayPolicy({
      batchSize: this.readInt('MEMORY_DECAY_BATCH_SIZE', 100),
      staleScoreThreshold: this.readFloat(
        'MEMORY_DECAY_STALE_SCORE_THRESHOLD',
        0.3,
      ),
      pruneScoreThreshold: this.readFloat(
        'MEMORY_DECAY_PRUNE_SCORE_THRESHOLD',
        0.15,
      ),
      pruneOlderThanDays: this.readInt(
        'MEMORY_DECAY_PRUNE_OLDER_THAN_DAYS',
        30,
      ),
    });
  }

  private readInt(name: string, fallback: number): number {
    const parsed = Number(process.env[name] ?? fallback);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private readFloat(name: string, fallback: number): number {
    const parsed = Number(process.env[name] ?? fallback);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }
}
