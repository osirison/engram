import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { PipelineStep, IngestContext } from './types.js';
import { PrivacyFilterStep } from './privacy-filter.step.js';
import { TopicDetectorStep } from './topic-detector.step.js';

/**
 * Stream B0 — Typed Ingest Pipeline (13 steps).
 *
 * This service owns the ordered execution of pipeline steps.
 *
 * - runSyncSteps(): runs steps 1–6 synchronously in the tool response path.
 * - Step 7 (PostgresWrite) and steps 11–12 (EmbeddingGenerate /
 *   SearchIndexUpdate) remain in MemoryLtmService so they can participate
 *   in the existing transaction and error handling.
 * - runAsyncHooks(): fires steps 3, 8–10, and 13 as fire-and-forget no-ops
 *   today, to be wired in Streams F, I, and D respectively.
 */
@Injectable()
export class IngestPipelineService {
  private readonly logger = new Logger(IngestPipelineService.name);

  /** Ordered synchronous steps executed in the tool response path (1–6). */
  private readonly syncSteps: PipelineStep<IngestContext>[];

  constructor(privacyFilter: PrivacyFilterStep, topicDetector: TopicDetectorStep) {
    this.syncSteps = [
      privacyFilter, // step 1 — PrivacyFilter
      // step 2 — ContentHashDedup is applied inline after syncSteps via computeHash()
      // step 3 — EntityExtractor: async no-op hook (Stream F)
      topicDetector, // step 4 — TopicDetector
      // step 5 — ImportanceScorer: applied inline by MemoryLtmService
      // step 6 — ContentSummarizer: passthrough stub (B3)
    ];
  }

  /**
   * Run pre-write synchronous steps (1–6) on the context.
   *
   * Returns the enriched context, or a context with `aborted: true` if an
   * exact duplicate was detected via content hash.
   *
   * The caller (MemoryLtmService) is responsible for:
   *   - step 7  (PostgresWrite)
   *   - step 11 (EmbeddingGenerate)
   *   - step 12 (SearchIndexUpdate)
   *
   * After step 7 succeeds the caller should invoke `runAsyncHooks()` for
   * steps 8–10 and 13.
   */
  async runSyncSteps(ctx: IngestContext): Promise<IngestContext> {
    let current = ctx;

    for (const step of this.syncSteps) {
      if (current.aborted) break;
      try {
        current = await step.execute(current);
      } catch (err) {
        this.logger.warn(
          `Ingest step '${step.name}' failed, continuing: ${err instanceof Error ? err.name : 'non-error thrown'}`
        );
      }
    }

    if (!current.aborted) {
      // Step 2 — compute hash of privacy-filtered content for the caller.
      const hash = this.computeHash(current.content);
      current = { ...current, contentHash: hash };
    }

    return current;
  }

  /**
   * Fire-and-forget async hooks for steps 8–10 and 13.
   *
   * These are no-ops today, wired in their respective streams:
   *   - step  8: EventLogAppend  (Stream I)
   *   - step  9: EntityGraphUpdate (Stream F)
   *   - step 10: BacklinkCompute   (Stream F)
   *   - step 13: VaultSync         (Stream D)
   *
   * Call this after a successful PostgresWrite (step 7).
   */
  runAsyncHooks(ctx: IngestContext, memoryId: string): void {
    void this.asyncHooksImpl(ctx, memoryId).catch((err: unknown) =>
      this.logger.warn(
        `Async ingest hooks failed for memory ${memoryId}: ${err instanceof Error ? err.name : 'non-error thrown'}`
      )
    );
  }

  private async asyncHooksImpl(ctx: IngestContext, memoryId: string): Promise<void> {
    // step 8 — EventLogAppend (Stream I: MemoryEvent table not yet in schema)
    this.logger.debug(`[hook:EventLogAppend] memory=${memoryId} userId=${ctx.userId}`);

    // step 3 — EntityExtractor (Stream F: entity graph not yet in schema)
    this.logger.debug(`[hook:EntityExtractor] memory=${memoryId}`);

    // step 9 — EntityGraphUpdate (Stream F)
    this.logger.debug(`[hook:EntityGraphUpdate] memory=${memoryId}`);

    // step 10 — BacklinkCompute (Stream F)
    this.logger.debug(`[hook:BacklinkCompute] memory=${memoryId}`);

    // step 13 — VaultSync (Stream D: vault not yet implemented)
    this.logger.debug(`[hook:VaultSync] memory=${memoryId}`);
  }

  /** SHA-256 of trimmed, lower-cased content. */
  computeHash(content: string): string {
    return createHash('sha256').update(content.trim().toLowerCase()).digest('hex');
  }
}
