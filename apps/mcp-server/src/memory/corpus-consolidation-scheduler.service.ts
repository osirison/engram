import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  CorpusConsolidationService,
  type CorpusConsolidationResult,
} from '@engram/memory-ltm';

const JOB_NAME = 'corpus_consolidation';

const EMPTY_RESULT: CorpusConsolidationResult = {
  scanned: 0,
  clusters: 0,
  merged: 0,
  skippedConcurrentEdit: 0,
  cursor: null,
  dryRun: false,
  perCluster: [],
  perClusterTruncated: false,
};

/**
 * DecayService-style scheduled wrapper around corpus consolidation (G3-T2).
 *
 * REVIEW-GATED (pinned Decision 3): `MEMORY_CONSOLIDATION_INTERVAL_MS`
 * defaults to 0 = OFF. Setting a positive interval is the operator's explicit
 * opt-in to unattended merging — each scheduled pass runs with
 * `dryRun: false` (a scheduled dry run would report to nobody). Inspect a
 * `consolidate_corpus` dry run before enabling. Per-run mutation safety stays
 * with the service itself: version-CAS writes, concurrent-edit skips, and
 * idempotent re-runs.
 */
@Injectable()
export class CorpusConsolidationSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    CorpusConsolidationSchedulerService.name,
  );
  private readonly intervalMs: number;

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    // Postgres-only (absent under profile-memory), so optional like the
    // controller's other Postgres-backed collaborators.
    @Optional()
    private readonly corpusConsolidation?: CorpusConsolidationService,
  ) {
    const parsed = Number(process.env.MEMORY_CONSOLIDATION_INTERVAL_MS ?? 0);
    this.intervalMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  onModuleInit(): void {
    if (this.intervalMs <= 0) {
      this.logger.log(
        'Corpus-consolidation scheduler disabled (MEMORY_CONSOLIDATION_INTERVAL_MS=0 — the default; review-gated opt-in)',
      );
      return;
    }
    const handle = setInterval(() => {
      void this.run().catch((error: unknown) =>
        this.logger.error('Scheduled corpus-consolidation pass failed:', error),
      );
    }, this.intervalMs);
    this.schedulerRegistry.addInterval(JOB_NAME, handle);
    this.logger.log(
      `Corpus-consolidation scheduler enabled: merging every ${this.intervalMs}ms (operator opt-in)`,
    );
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', JOB_NAME)) {
      this.schedulerRegistry.deleteInterval(JOB_NAME);
    }
  }

  async run(): Promise<CorpusConsolidationResult> {
    if (!this.corpusConsolidation) {
      this.logger.warn(
        'CorpusConsolidationScheduler: consolidation service unavailable, skipping run',
      );
      return EMPTY_RESULT;
    }

    // dryRun: false is deliberate — enabling the interval IS the review-gate
    // opt-in; everything else (thresholds, batch size) uses service defaults
    // sourced from validated env.
    return await this.corpusConsolidation.run({ dryRun: false });
  }
}
