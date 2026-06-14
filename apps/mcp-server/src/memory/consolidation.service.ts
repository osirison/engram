import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { MemoryStmService } from '@engram/memory-stm';
import {
  MemoryLtmService,
  LtmMemoryQuotaExceededError,
} from '@engram/memory-ltm';

export interface ConsolidationResult {
  promoted: number;
  skipped: number;
  failed: number;
}

const JOB_NAME = 'stm_consolidation';

@Injectable()
export class ConsolidationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConsolidationService.name);
  private readonly accessThreshold: number;
  private readonly intervalMs: number;

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    @Optional() private readonly stmService?: MemoryStmService,
    @Optional() private readonly ltmService?: MemoryLtmService,
  ) {
    this.accessThreshold = ConsolidationService.parseEnvInt(
      process.env.STM_CONSOLIDATION_ACCESS_THRESHOLD,
      3,
    );
    this.intervalMs = ConsolidationService.parseEnvInt(
      process.env.STM_CONSOLIDATION_INTERVAL_MS,
      300_000,
    );
  }

  private static parseEnvInt(
    raw: string | undefined,
    fallback: number,
  ): number {
    const n = parseInt(raw ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  onModuleInit(): void {
    if (this.intervalMs > 0) {
      const handle = setInterval(() => {
        void this.run().catch((err: unknown) =>
          this.logger.error('Scheduled consolidation pass failed:', err),
        );
      }, this.intervalMs);
      this.schedulerRegistry.addInterval(JOB_NAME, handle);
      this.logger.log(
        `Consolidation scheduler registered (interval=${this.intervalMs}ms)`,
      );
    } else {
      this.logger.log(
        'Consolidation scheduler disabled (STM_CONSOLIDATION_INTERVAL_MS=0)',
      );
    }
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', JOB_NAME)) {
      this.schedulerRegistry.deleteInterval(JOB_NAME);
    }
  }

  /**
   * Run one consolidation pass: find STM memories that meet the access
   * threshold and promote them to LTM.
   *
   * @param userId - When provided, restrict the scan to this user only.
   *
   * Importance scoring is deferred to issue #122; the current policy promotes
   * purely on access frequency.
   */
  async run(userId?: string): Promise<ConsolidationResult> {
    if (!this.stmService || !this.ltmService) {
      this.logger.warn(
        'ConsolidationService: STM or LTM service unavailable, skipping run',
      );
      return { promoted: 0, skipped: 0, failed: 0 };
    }

    this.logger.log(
      `Starting consolidation pass (threshold=${this.accessThreshold})`,
    );

    const candidates = await this.stmService.findCandidates(
      this.accessThreshold,
      userId,
    );

    let promoted = 0;
    let skipped = 0;
    let failed = 0;

    for (const memory of candidates) {
      try {
        await this.ltmService.promote(memory.userId, memory.id);
        promoted++;
        this.logger.debug(
          `Promoted STM memory ${memory.id} for user ${memory.userId}`,
        );
      } catch (error) {
        if (this.isAlreadyPromoted(error)) {
          // A concurrent run already promoted this memory — not an error.
          skipped++;
          this.logger.debug(
            `Memory ${memory.id} already promoted (race), skipping`,
          );
        } else if (error instanceof LtmMemoryQuotaExceededError) {
          skipped++;
          this.logger.warn(
            `Quota exceeded for user ${memory.userId}, skipping memory ${memory.id}`,
          );
        } else {
          failed++;
          this.logger.error(
            `Failed to promote memory ${memory.id}: ${String(error)}`,
          );
        }
      }
    }

    this.logger.log(
      `Consolidation pass complete: promoted=${promoted} skipped=${skipped} failed=${failed}`,
    );
    return { promoted, skipped, failed };
  }

  private isAlreadyPromoted(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    // Prisma P2002 (unique constraint) means the memory was already promoted.
    // MemoryLtmService.promote() wraps unexpected errors in LtmPromotionError,
    // so the signal may appear either as a raw Prisma error or inside the
    // LtmPromotionError message. Check the message in both cases.
    return (
      error.message.includes('Unique constraint') ||
      error.message.includes('unique constraint') ||
      error.message.includes('P2002')
    );
  }
}
