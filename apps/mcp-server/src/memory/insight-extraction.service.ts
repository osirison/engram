import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import OpenAI from 'openai';
import type { LtmMemory } from '@engram/memory-ltm';
import { MemoryLtmService } from '@engram/memory-ltm';

const JOB_NAME = 'ltm_insight_extraction';

const TOPIC_TAGS = [
  'engineering',
  'decision',
  'problem',
  'milestone',
  'product',
  'learning',
] as const;
type TopicTag = (typeof TOPIC_TAGS)[number];

export interface InsightExtractionResult {
  insightsCreated: number;
  memoriesClustered: number;
  skippedTopics: number;
}

@Injectable()
export class InsightExtractionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InsightExtractionService.name);
  private readonly openaiClient: OpenAI | null;
  private readonly intervalMs: number;
  private readonly minClusterSize: number;
  private readonly maxClusterSize: number;

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    @Optional() private readonly ltmService?: MemoryLtmService,
  ) {
    const apiKey = process.env['OPENAI_API_KEY'];
    this.openaiClient = apiKey ? new OpenAI({ apiKey }) : null;
    this.intervalMs = InsightExtractionService.readEnvInt(
      'MEMORY_INSIGHT_INTERVAL_MS',
      3_600_000,
    );
    this.minClusterSize = InsightExtractionService.readEnvInt(
      'MEMORY_INSIGHT_MIN_CLUSTER_SIZE',
      3,
    );
    this.maxClusterSize = InsightExtractionService.readEnvInt(
      'MEMORY_INSIGHT_MAX_CLUSTER_SIZE',
      10,
    );
  }

  onModuleInit(): void {
    if (this.intervalMs <= 0) {
      this.logger.log(
        'Insight extraction scheduler disabled (MEMORY_INSIGHT_INTERVAL_MS=0)',
      );
      return;
    }
    const handle = setInterval(() => {
      void this.run().catch((err: unknown) =>
        this.logger.error('Scheduled insight extraction pass failed:', err),
      );
    }, this.intervalMs);
    this.schedulerRegistry.addInterval(JOB_NAME, handle);
    this.logger.log(
      `Insight extraction scheduler registered (interval=${this.intervalMs}ms)`,
    );
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('interval', JOB_NAME)) {
      this.schedulerRegistry.deleteInterval(JOB_NAME);
    }
  }

  async run(): Promise<InsightExtractionResult> {
    if (!this.ltmService) {
      this.logger.warn(
        'InsightExtractionService: LTM service unavailable, skipping run',
      );
      return { insightsCreated: 0, memoriesClustered: 0, skippedTopics: 0 };
    }

    this.logger.log('Starting insight extraction pass');
    let insightsCreated = 0;
    let memoriesClustered = 0;
    let skippedTopics = 0;

    for (const topic of TOPIC_TAGS) {
      const result = await this.processTopicCluster(topic);
      insightsCreated += result.insightsCreated;
      memoriesClustered += result.memoriesClustered;
      skippedTopics += result.skippedTopics;
    }

    this.logger.log(
      `Insight extraction pass complete: insightsCreated=${insightsCreated} memoriesClustered=${memoriesClustered} skippedTopics=${skippedTopics}`,
    );
    return { insightsCreated, memoriesClustered, skippedTopics };
  }

  private async processTopicCluster(
    topic: TopicTag,
  ): Promise<InsightExtractionResult> {
    const candidates = await this.ltmService!.findInsightCandidates(
      topic,
      this.maxClusterSize * 20,
    );

    // Group by userId+organizationId so insights stay within a tenant.
    const byUserKey = new Map<string, LtmMemory[]>();
    for (const memory of candidates) {
      const key = `${memory.userId}::${memory.organizationId ?? ''}`;
      const bucket = byUserKey.get(key) ?? [];
      bucket.push(memory);
      byUserKey.set(key, bucket);
    }

    let insightsCreated = 0;
    let memoriesClustered = 0;
    let skippedTopics = 0;

    for (const memories of byUserKey.values()) {
      if (memories.length < this.minClusterSize) {
        skippedTopics++;
        continue;
      }

      const cluster = memories.slice(0, this.maxClusterSize);
      const first = cluster[0];
      if (!first) continue;
      const { userId, organizationId } = first;

      const summary = await this.summarizeCluster(topic, cluster);
      if (!summary) {
        skippedTopics++;
        continue;
      }

      try {
        const insightMemory = await this.ltmService!.create({
          userId,
          organizationId: organizationId ?? undefined,
          content: summary,
          tags: ['insight', topic],
          metadata: {
            isInsight: true,
            topic,
            sourceMemoryIds: cluster.map((m) => m.id),
            clusterSize: cluster.length,
            extractedAt: new Date().toISOString(),
          },
          skipDuplicateCheck: true,
        });

        await this.annotateSourceMemories(cluster, insightMemory.id);
        insightsCreated++;
        memoriesClustered += cluster.length;
        this.logger.debug(
          `Created insight ${insightMemory.id} for user ${userId} topic=${topic} clusterSize=${cluster.length}`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to create insight for user ${userId} topic=${topic}: ${String(err)}`,
        );
      }
    }

    return { insightsCreated, memoriesClustered, skippedTopics };
  }

  private async annotateSourceMemories(
    memories: LtmMemory[],
    insightId: string,
  ): Promise<void> {
    const clusteredAt = new Date().toISOString();
    await Promise.all(
      memories.map((mem) =>
        this.ltmService!.update(
          mem.userId,
          mem.id,
          {
            metadata: {
              ...(mem.metadata ?? {}),
              insightId,
              clusteredAt,
            },
          },
          mem.organizationId ?? undefined,
        ).catch((err: unknown) =>
          this.logger.warn(
            `Failed to annotate source memory ${mem.id}: ${String(err)}`,
          ),
        ),
      ),
    );
  }

  protected async summarizeCluster(
    topic: string,
    memories: Pick<LtmMemory, 'content'>[],
  ): Promise<string | null> {
    if (!this.openaiClient) {
      this.logger.debug(
        'OpenAI client unavailable, skipping LLM summarization',
      );
      return null;
    }

    const snippets = memories
      .map((m, i) => `${i + 1}. ${m.content.slice(0, 300)}`)
      .join('\n');

    try {
      const response = await this.openaiClient.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a memory distiller. Given related memory snippets about "${topic}", produce a concise insight (2-4 sentences) capturing the key pattern, decision, or learning. Write the insight as a standalone fact without referencing the source memories.`,
          },
          { role: 'user', content: snippets },
        ],
        max_tokens: 200,
        temperature: 0.3,
      });

      return response.choices[0]?.message?.content?.trim() ?? null;
    } catch (err) {
      this.logger.error(
        `LLM summarization failed for topic=${topic}: ${String(err)}`,
      );
      return null;
    }
  }

  private static readEnvInt(name: string, fallback: number): number {
    const raw = process.env[name];
    const parsed = raw !== undefined ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }
}
