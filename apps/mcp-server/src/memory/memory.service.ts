import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { MemoryStmService, StmMemoryNotFoundError } from '@engram/memory-stm';
import {
  MemoryLtmService,
  LtmMemoryNotFoundError,
  ImportanceScoringService,
} from '@engram/memory-ltm';
import { Memory } from '@engram/database';

type MemoryListResult = {
  items: Memory[];
  totalCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
};

type StmServiceContract = {
  create: (input: {
    userId: string;
    content: string;
    scope?: string;
    metadata?: Record<string, unknown>;
    tags?: string[];
    ttl?: number;
  }) => Promise<Memory>;
  findById: (userId: string, memoryId: string) => Promise<Memory>;
  update: (
    userId: string,
    memoryId: string,
    input: {
      content?: string;
      metadata?: Record<string, unknown>;
      tags?: string[];
      ttl?: number;
    },
  ) => Promise<Memory>;
  delete: (userId: string, memoryId: string) => Promise<void>;
  list: (
    userId: string,
    options: { limit: number },
  ) => Promise<MemoryListResult>;
};

type LtmServiceContract = {
  create: (input: {
    userId: string;
    content: string;
    scope?: string;
    metadata?: Record<string, unknown>;
    tags?: string[];
    skipDuplicateCheck?: boolean;
  }) => Promise<Memory>;
  get: (userId: string, memoryId: string) => Promise<Memory | null>;
  update: (
    userId: string,
    memoryId: string,
    input: {
      content?: string;
      metadata?: Record<string, unknown>;
      tags?: string[];
    },
  ) => Promise<Memory>;
  delete: (userId: string, memoryId: string) => Promise<boolean>;
  list: (
    userId: string,
    options: {
      limit: number;
      cursor?: string;
      scope?: string;
      tags?: string[];
      search?: string;
      sortBy?: 'createdAt' | 'updatedAt';
      sortOrder?: 'asc' | 'desc';
    },
  ) => Promise<MemoryListResult>;
  promote: (userId: string, memoryId: string) => Promise<Memory>;
  semanticSearch: (
    userId: string,
    query: string,
    options?: {
      limit?: number;
      scope?: string;
      tags?: string[];
      createdFrom?: Date;
      createdTo?: Date;
    },
  ) => Promise<Array<{ memory: Memory; score: number }>>;
  reindex: (options?: {
    userId?: string;
    batchSize?: number;
    reuseExistingEmbeddings?: boolean;
    cursor?: string;
    maxMemories?: number;
  }) => Promise<ReindexSummary>;
};

export interface ReindexSummary {
  processed: number;
  indexed: number;
  skipped: number;
  failed: number;
  cursor: string | null;
}

export interface ReindexOptions {
  userId?: string;
  batchSize?: number;
  reuseExistingEmbeddings?: boolean;
  cursor?: string;
  maxMemories?: number;
}

export interface CreateMemoryDto {
  userId: string;
  content: string;
  type: 'short-term' | 'long-term';
  scope?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  ttl?: number;
  skipDuplicateCheck?: boolean;
}

export interface UpdateMemoryDto {
  content?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  ttl?: number;
}

export interface ListMemoryOptions {
  limit?: number;
  cursor?: string;
  scope?: string;
  tags?: string[];
  search?: string;
}

export interface RecallOptions {
  limit?: number;
  scope?: string;
  tags?: string[];
  createdFrom?: Date;
  createdTo?: Date;
}

export interface RecallResult {
  memory: Memory;
  score: number;
}

export interface PaginatedMemories {
  items: Memory[];
  totalCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
}

// ─── C1: High-Level Agent UX result types ────────────────────────────────────

export interface RememberResult {
  memory: Memory;
  /** True when the incoming content matched an existing memory above the duplicate threshold */
  wasDeduped: boolean;
  /** Resolved storage tier after auto-detection */
  resolvedType: 'short-term' | 'long-term';
}

export interface ForgetCandidate {
  memoryId: string;
  content: string;
  score: number;
}

export interface ForgetResult {
  candidates: ForgetCandidate[];
  /** Number of memories actually deleted (0 when confirm=false) */
  deleted: number;
  dryRun: boolean;
}

export interface ReflectResult {
  query: string;
  summary: string;
  themes: string[];
  sourceIds: string[];
  memoryCount: number;
  dateRange: { earliest: string; latest: string } | null;
}

export interface ContextBlock {
  /** Formatted text ready for prompt injection */
  context: string;
  memoryCount: number;
  truncated: boolean;
  charCount: number;
}

export interface PromptContextBlock {
  /** Formatted text ready for prompt injection, ranked by relevance */
  context: string;
  memoryCount: number;
  truncated: boolean;
  /** Token estimate of the assembled block (~4 chars/token; may under-count for CJK/emoji) */
  estimatedTokens: number;
  /** The token budget that was requested */
  tokenBudget: number;
  /** Total candidates returned by semantic search before minScore filtering */
  candidatesFound: number;
}

export interface IngestConversationResult {
  /** Number of chunks successfully stored as new memories */
  ingested: number;
  /** Number of chunks skipped due to exact-content deduplication */
  skipped: number;
  /** Number of chunks that failed (errors are non-fatal; ingest continues) */
  failed: number;
  /** Total chunks processed: ingested + skipped + failed */
  total: number;
  /**
   * Memory IDs in chunk order. An empty string (`''`) at index `i` indicates
   * that chunk `i` failed to store; the failure is also reflected in `failed`.
   */
  memoryIds: string[];
}

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  private readonly stm: StmServiceContract;
  private readonly ltm: LtmServiceContract;

  constructor(
    private readonly stmService: MemoryStmService,
    private readonly ltmService: MemoryLtmService,
    @Optional() private readonly importanceService?: ImportanceScoringService,
  ) {
    this.stm = this.stmService as unknown as StmServiceContract;
    this.ltm = this.ltmService;
  }

  /**
   * Create a memory - routes to STM or LTM based on type
   */
  async createMemory(dto: CreateMemoryDto): Promise<Memory> {
    this.logger.debug(`Creating ${dto.type} memory for user: ${dto.userId}`);

    if (dto.type === 'short-term') {
      // Create short-term memory with TTL
      return await this.stm.create({
        userId: dto.userId,
        content: dto.content,
        scope: dto.scope,
        metadata: dto.metadata,
        tags: dto.tags,
        ttl: dto.ttl,
      });
    } else {
      // Create long-term memory
      return await this.ltm.create({
        userId: dto.userId,
        content: dto.content,
        scope: dto.scope,
        metadata: dto.metadata,
        tags: dto.tags,
        skipDuplicateCheck: dto.skipDuplicateCheck,
      });
    }
  }

  /**
   * Get a memory - tries STM first, then falls back to LTM
   */
  async getMemory(userId: string, memoryId: string): Promise<Memory | null> {
    this.logger.debug(`Getting memory ${memoryId} for user: ${userId}`);

    try {
      // Try STM first (faster access)
      const stmMemory = await this.stm.findById(userId, memoryId);
      return stmMemory;
    } catch (error) {
      if (error instanceof StmMemoryNotFoundError) {
        // Not in STM, try LTM
        this.logger.debug(`Memory ${memoryId} not found in STM, checking LTM`);
        try {
          const ltmMemory = await this.ltm.get(userId, memoryId);
          return ltmMemory;
        } catch (ltmError) {
          if (ltmError instanceof LtmMemoryNotFoundError) {
            // Not found in either store
            return null;
          }
          throw ltmError;
        }
      }
      throw error;
    }
  }

  /**
   * List memories - combines results from both STM and LTM with pagination
   */
  async listMemories(
    userId: string,
    options: ListMemoryOptions = {},
  ): Promise<PaginatedMemories> {
    this.logger.debug(
      `Listing memories for user: ${userId} with options:`,
      options,
    );

    const limit = options.limit || 20;

    // Get memories from both services
    // Note: STM list is not fully implemented yet, but we'll call it anyway
    const [stmResult, ltmResult] = await Promise.all([
      this.stm
        .list(userId, { limit })
        .catch(() => ({ items: [] as Memory[], totalCount: 0 })),
      this.ltm.list(userId, {
        limit,
        cursor: options.cursor,
        scope: options.scope,
        tags: options.tags,
        search: options.search,
      }),
    ]);

    const stmMemories: Memory[] = Array.isArray(stmResult)
      ? stmResult
      : stmResult.items;

    // Combine and sort by creation date (newest first)
    const combinedMemories: Memory[] = [...stmMemories, ...ltmResult.items];
    combinedMemories.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );

    // Apply limit
    const paginatedItems = combinedMemories.slice(0, limit);
    const hasMore = combinedMemories.length > limit;

    return {
      items: paginatedItems,
      totalCount: ltmResult.totalCount + stmResult.totalCount,
      hasNextPage: hasMore || ltmResult.hasNextPage,
      hasPreviousPage: ltmResult.hasPreviousPage,
      startCursor:
        paginatedItems.length > 0 ? paginatedItems[0]?.id : undefined,
      endCursor:
        paginatedItems.length > 0
          ? paginatedItems[paginatedItems.length - 1]?.id
          : undefined,
    };
  }

  /**
   * Update a memory - routes to appropriate service based on where it exists
   */
  async updateMemory(
    userId: string,
    memoryId: string,
    updates: UpdateMemoryDto,
  ): Promise<Memory> {
    this.logger.debug(
      `Updating memory ${memoryId} for user: ${userId} with updates:`,
      updates,
    );

    // Try to find the memory first to determine which service to use
    try {
      // Try STM first
      await this.stm.findById(userId, memoryId);

      // Found in STM, update it
      return await this.stm.update(userId, memoryId, {
        content: updates.content,
        metadata: updates.metadata,
        tags: updates.tags ?? ([] as string[]),
        ttl: updates.ttl,
      });
    } catch (error) {
      if (error instanceof StmMemoryNotFoundError) {
        // Not in STM, try LTM
        this.logger.debug(`Memory ${memoryId} not in STM, trying LTM`);

        const ltmMemory = await this.ltm.get(userId, memoryId);
        if (!ltmMemory) {
          throw new NotFoundException(`Memory ${memoryId} not found`);
        }

        // Update in LTM (TTL is ignored for LTM)
        return await this.ltm.update(userId, memoryId, {
          content: updates.content,
          metadata: updates.metadata,
          tags: updates.tags,
        });
      }
      throw error;
    }
  }

  /**
   * Delete a memory - tries both STM and LTM
   */
  async deleteMemory(userId: string, memoryId: string): Promise<boolean> {
    this.logger.debug(`Deleting memory ${memoryId} for user: ${userId}`);

    let deletedFromStm = false;
    let deletedFromLtm = false;

    // Try to delete from STM
    try {
      await this.stm.delete(userId, memoryId);
      deletedFromStm = true;
      this.logger.debug(`Memory ${memoryId} deleted from STM`);
    } catch (error) {
      if (!(error instanceof StmMemoryNotFoundError)) {
        throw error;
      }
    }

    // Try to delete from LTM
    try {
      deletedFromLtm = await this.ltm.delete(userId, memoryId);
      if (deletedFromLtm) {
        this.logger.debug(`Memory ${memoryId} deleted from LTM`);
      }
    } catch (error) {
      if (!(error instanceof LtmMemoryNotFoundError)) {
        throw error;
      }
    }

    // Return true if deleted from either service
    return deletedFromStm || deletedFromLtm;
  }

  /**
   * Promote a memory from STM to LTM
   */
  async promoteMemory(userId: string, memoryId: string): Promise<Memory> {
    this.logger.debug(
      `Promoting memory ${memoryId} from STM to LTM for user: ${userId}`,
    );

    // Use LTM service's promote method which handles the transfer
    return await this.ltm.promote(userId, memoryId);
  }

  /**
   * Semantic recall - finds the most relevant long-term memories for a query
   * using vector similarity search.
   */
  async recall(
    userId: string,
    query: string,
    options: RecallOptions = {},
  ): Promise<RecallResult[]> {
    this.logger.debug(`Recalling memories for user: ${userId}`);

    return await this.ltm.semanticSearch(userId, query, {
      limit: options.limit,
      scope: options.scope,
      tags: options.tags,
      createdFrom: options.createdFrom,
      createdTo: options.createdTo,
    });
  }

  /**
   * Rebuild the vector store from Postgres. Backfills embeddings for one user
   * or every user. Idempotent and safe to re-run.
   */
  async reindex(options: ReindexOptions = {}): Promise<ReindexSummary> {
    this.logger.debug(
      `Reindexing vector store${options.userId ? ` for user: ${options.userId}` : ' for all users'}`,
    );

    return await this.ltm.reindex(options);
  }

  // ─── C1: High-Level Agent UX Methods ───────────────────────────────────────

  /**
   * Smart create: auto-detects STM vs LTM, deduplicates.
   * Returns the stored memory plus routing metadata.
   */
  async remember(input: {
    userId: string;
    content: string;
    type: 'auto' | 'short-term' | 'long-term';
    scope?: string;
    metadata?: Record<string, unknown>;
    tags?: string[];
    ttl?: number;
    skipDuplicateCheck: boolean;
  }): Promise<RememberResult> {
    const resolvedType =
      input.type === 'auto'
        ? MemoryService.detectMemoryType(input.content, input.ttl)
        : input.type;

    const memory = await this.createMemory({
      userId: input.userId,
      content: input.content,
      type: resolvedType,
      scope: input.scope,
      metadata: input.metadata,
      tags: input.tags,
      ttl: input.ttl,
      skipDuplicateCheck: input.skipDuplicateCheck,
    });

    const wasDeduped = MemoryService.hasDedupeAnnotation(memory.metadata);

    return { memory, wasDeduped, resolvedType };
  }

  /**
   * Smart delete: find memories by concept, optionally delete them.
   */
  async forget(input: {
    userId: string;
    query: string;
    limit: number;
    confirm: boolean;
    minScore: number;
  }): Promise<ForgetResult> {
    const hits = await this.ltm.semanticSearch(input.userId, input.query, {
      limit: input.limit,
    });

    const candidates: ForgetCandidate[] = hits
      .filter((h) => h.score >= input.minScore)
      .map((h) => ({
        memoryId: h.memory.id,
        content: h.memory.content,
        score: h.score,
      }));

    let deleted = 0;
    if (input.confirm && candidates.length > 0) {
      const results = await Promise.allSettled(
        candidates.map((c) => this.deleteMemory(input.userId, c.memoryId)),
      );
      deleted = results.filter(
        (r) => r.status === 'fulfilled' && r.value,
      ).length;
    }

    return { candidates, deleted, dryRun: !input.confirm };
  }

  /**
   * Synthesise structured insights across semantically relevant memories.
   */
  async reflect(input: {
    userId: string;
    query: string;
    limit: number;
    minScore: number;
    scope?: string;
    tags?: string[];
  }): Promise<ReflectResult> {
    const hits = await this.ltm.semanticSearch(input.userId, input.query, {
      limit: input.limit,
      scope: input.scope,
      tags: input.tags,
    });

    const relevant = hits.filter((h) => h.score >= input.minScore);
    if (relevant.length === 0) {
      return {
        query: input.query,
        summary: 'No relevant memories found for this query.',
        themes: [],
        sourceIds: [],
        memoryCount: 0,
        dateRange: null,
      };
    }

    const memories = relevant.map((h) => h.memory);
    const sourceIds = memories.map((m) => m.id);

    // Extract themes from tags
    const themes = MemoryService.extractThemes(memories);

    // Build a concise structured summary
    const summary = MemoryService.synthesiseSummary(input.query, relevant);

    const dates = memories.map((m) => m.createdAt.getTime());
    const dateRange = {
      earliest: new Date(Math.min(...dates)).toISOString(),
      latest: new Date(Math.max(...dates)).toISOString(),
    };

    return {
      query: input.query,
      summary,
      themes,
      sourceIds,
      memoryCount: memories.length,
      dateRange,
    };
  }

  /**
   * Retrieve + contextually compress memories for context window injection.
   */
  async compressContext(input: {
    userId: string;
    query: string;
    limit: number;
    maxChars: number;
    minScore: number;
    scope?: string;
  }): Promise<ContextBlock> {
    const hits = await this.ltm.semanticSearch(input.userId, input.query, {
      limit: input.limit,
      scope: input.scope,
    });

    const relevant = hits.filter((h) => h.score >= input.minScore);
    return MemoryService.buildContextBlock(
      relevant.map((h) => h.memory),
      input.maxChars,
    );
  }

  /**
   * Assemble a token-budgeted context block ranked by query relevance.
   * Uses a conservative ~4 chars/token estimate so the assembled block stays
   * within the requested budget. Memories are greedy-packed in relevance order;
   * content is truncated when a single memory exceeds the remaining budget.
   */
  async assemblePromptContext(input: {
    userId: string;
    query: string;
    tokenBudget: number;
    limit: number;
    minScore: number;
    scope?: string;
    tags?: string[];
    createdFrom?: Date;
    createdTo?: Date;
  }): Promise<PromptContextBlock> {
    const hits = await this.ltm.semanticSearch(input.userId, input.query, {
      limit: input.limit,
      scope: input.scope,
      tags: input.tags,
      createdFrom: input.createdFrom,
      createdTo: input.createdTo,
    });

    const relevant = hits.filter((h) => h.score >= input.minScore);
    return MemoryService.buildTokenBudgetedBlock(
      relevant.map((h) => h.memory),
      input.tokenBudget,
      hits.length,
    );
  }

  /**
   * Load the most relevant memories for a session opening.
   * Blends recency with importance so the agent is primed with both
   * fresh context and durable knowledge.
   */
  async loadContext(input: {
    userId: string;
    maxChars: number;
    recentLimit: number;
    importantLimit: number;
    scope?: string;
    tags?: string[];
  }): Promise<ContextBlock> {
    const [recentResult, importantResult] = await Promise.all([
      input.recentLimit > 0
        ? this.ltm.list(input.userId, {
            limit: input.recentLimit,
            sortBy: 'createdAt',
            sortOrder: 'desc',
            scope: input.scope,
            tags: input.tags,
          })
        : Promise.resolve({ items: [] as Memory[] }),
      input.importantLimit > 0
        ? this.ltm.list(input.userId, {
            limit: input.importantLimit * 3, // fetch extra, sort by importance, take top N
            sortBy: 'updatedAt',
            sortOrder: 'desc',
            scope: input.scope,
            tags: input.tags,
          })
        : Promise.resolve({ items: [] as Memory[] }),
    ]);

    // Sort the broad set by importance score and take top N
    const importantSorted = this.sortByImportance(importantResult.items).slice(
      0,
      input.importantLimit,
    );

    // Merge: recent first, then important; deduplicate by ID
    const seen = new Set<string>();
    const merged: Memory[] = [];
    for (const m of [...recentResult.items, ...importantSorted]) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        merged.push(m);
      }
    }

    return MemoryService.buildContextBlock(merged, input.maxChars);
  }

  /**
   * Ingest a conversation as a sequence of per-turn memories.
   *
   * Each turn is formatted as "<role>: <content>" and stored via `remember()`.
   * Turns longer than 10 KB are split into multiple chunks at paragraph/newline
   * boundaries so every stored memory stays within the single-memory size cap.
   *
   * `concurrency` bounds how many `remember` calls run at once — this limits
   * embedding API back-pressure without serialising the whole batch.
   *
   * Idempotent: re-submitting the same conversation produces the same memory IDs
   * because LTM exact-content dedup (content hash) is always active.
   */
  async ingestConversation(input: {
    userId: string;
    turns: Array<{ role: string; content: string }>;
    concurrency: number;
    tags: string[];
    metadata?: Record<string, unknown>;
  }): Promise<IngestConversationResult> {
    const chunks = MemoryService.splitTurnsToChunks(input.turns);

    const accum = {
      ingested: 0,
      skipped: 0,
      failed: 0,
      memoryIds: new Array<string>(chunks.length).fill(''),
    };

    await MemoryService.runConcurrent(
      chunks.map((chunk, i) => async (): Promise<void> => {
        try {
          const { memory, wasDeduped } = await this.remember({
            userId: input.userId,
            content: chunk,
            type: 'long-term',
            tags: input.tags,
            metadata: input.metadata,
            skipDuplicateCheck: false,
          });
          accum.memoryIds[i] = memory.id;
          if (wasDeduped) {
            accum.skipped++;
          } else {
            accum.ingested++;
          }
        } catch {
          accum.failed++;
          // accum.memoryIds[i] remains '' to mark the failure
        }
      }),
      input.concurrency,
    );

    return {
      ...accum,
      total: accum.ingested + accum.skipped + accum.failed,
    };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Heuristic routing: classify content as short-term or long-term.
   * Temporal / in-progress cues → STM; factual / knowledge cues → LTM.
   */
  private static detectMemoryType(
    content: string,
    ttl?: number,
  ): 'short-term' | 'long-term' {
    if (ttl !== undefined) {
      return 'short-term';
    }
    const lower = content.toLowerCase();
    const stmPatterns = [
      /\b(today|tonight|tomorrow|right now|currently|at the moment)\b/,
      /\b(working on|in progress|just (started|finished|did|updated))\b/,
      /\b(this (morning|afternoon|evening|week))\b/,
      /\b(temporary|reminder|don'?t forget|later today)\b/,
    ];
    if (stmPatterns.some((re) => re.test(lower))) {
      return 'short-term';
    }
    return 'long-term';
  }

  /** Check whether the memory was silently deduplicated by the LTM service. */
  private static hasDedupeAnnotation(metadata: unknown): boolean {
    if (!metadata || typeof metadata !== 'object') return false;
    const m = metadata as Record<string, unknown>;
    return (
      Array.isArray(m['duplicateMatches']) &&
      (m['duplicateMatches'] as unknown[]).length > 0
    );
  }

  /** Extract the top recurring tags and content keywords as themes. */
  private static extractThemes(memories: Memory[]): string[] {
    const freq = new Map<string, number>();
    for (const m of memories) {
      for (const tag of m.tags) {
        freq.set(tag, (freq.get(tag) ?? 0) + 1);
      }
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag]) => tag);
  }

  /** Build a plain-text reflective summary from ranked recall hits. */
  private static synthesiseSummary(
    query: string,
    hits: Array<{ memory: Memory; score: number }>,
  ): string {
    const lines: string[] = [
      `Reflection on: "${query}"`,
      `Based on ${hits.length} relevant memor${hits.length === 1 ? 'y' : 'ies'}:`,
      '',
    ];
    for (const { memory, score } of hits.slice(0, 5)) {
      const date = memory.createdAt.toISOString().slice(0, 10);
      const snippet =
        memory.content.length > 200
          ? memory.content.slice(0, 197) + '...'
          : memory.content;
      lines.push(`[${date} | score ${score.toFixed(2)}] ${snippet}`);
    }
    if (hits.length > 5) {
      lines.push(`… and ${hits.length - 5} more.`);
    }
    return lines.join('\n');
  }

  /** Format memories into an injectable context block, truncating to charBudget. */
  private static buildContextBlock(
    memories: Memory[],
    maxChars: number,
  ): ContextBlock {
    if (memories.length === 0) {
      const context = '(no memories)';
      return {
        context,
        memoryCount: 0,
        truncated: false,
        charCount: context.length,
      };
    }
    const lines: string[] = ['## Memory Context', ''];
    let used = 0;
    let included = 0;
    let truncated = false;

    for (const m of memories) {
      const date = m.createdAt.toISOString().slice(0, 10);
      const tagPart = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
      const header = `### [${date}]${tagPart}`;
      const budget = maxChars - used - header.length - 2;
      if (budget <= 0) {
        truncated = true;
        break;
      }
      const content =
        m.content.length > budget
          ? m.content.slice(0, budget - 3) + '...'
          : m.content;
      const entry = `${header}\n${content}\n`;
      lines.push(entry);
      used += entry.length;
      included++;
      if (used >= maxChars) {
        truncated = true;
        break;
      }
    }

    const context = lines.join('\n');
    return {
      context,
      memoryCount: included,
      truncated,
      charCount: context.length,
    };
  }

  /**
   * Token estimate: ceil(chars / 4). Conservative for ASCII/English text; may
   * severely under-count for CJK, emoji, or other multi-byte content where BPE
   * models produce 4–6× more tokens per character. The budget guarantee only
   * holds for predominantly ASCII input.
   */
  static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Greedy-pack memories into a token-budgeted block, ranked by relevance order.
   * Content is truncated when a single memory would otherwise overflow the budget.
   * The assembled block is guaranteed to satisfy estimatedTokens ≤ tokenBudget.
   */
  static buildTokenBudgetedBlock(
    memories: Memory[],
    tokenBudget: number,
    candidatesFound = 0,
  ): PromptContextBlock {
    if (memories.length === 0) {
      const ctx = '(no memories)';
      return {
        context: ctx,
        memoryCount: 0,
        truncated: false,
        estimatedTokens: MemoryService.estimateTokens(ctx),
        tokenBudget,
        candidatesFound,
      };
    }

    const preamble = '## Memory Context\n\n';
    let assembled = preamble;
    let included = 0;
    let truncated = false;

    for (const m of memories) {
      const date = m.createdAt.toISOString().slice(0, 10);
      const tagPart = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
      const entryHeader = `### [${date}]${tagPart}\n`;

      const currentTokens = MemoryService.estimateTokens(assembled);
      const headerTokens = MemoryService.estimateTokens(entryHeader);
      // -4: safety margin so ceil() rounding can't push us over budget.
      // -3 below (in slice) matches the 3-char '...' suffix — keep both in sync.
      const maxContentChars =
        (tokenBudget - currentTokens - headerTokens) * 4 - 4;

      if (maxContentChars <= 0) {
        truncated = true;
        break;
      }

      const contentTruncated = m.content.length > maxContentChars;
      const content = contentTruncated
        ? m.content.slice(0, maxContentChars - 3) + '...'
        : m.content;
      if (contentTruncated) truncated = true;

      assembled += `${entryHeader}${content}\n`;
      included++;

      if (MemoryService.estimateTokens(assembled) >= tokenBudget) {
        if (included < memories.length) truncated = true;
        break;
      }
    }

    return {
      context: assembled,
      memoryCount: included,
      truncated,
      estimatedTokens: MemoryService.estimateTokens(assembled),
      tokenBudget,
      candidatesFound,
    };
  }

  /**
   * Format conversation turns into storable chunks ≤ 10 KB each.
   * Each turn becomes "<role>: <content>". Turns exceeding the limit are split
   * at double-newline boundaries (paragraphs), falling back to hard char cuts.
   */
  static splitTurnsToChunks(
    turns: Array<{ role: string; content: string }>,
    charLimit = 10240,
  ): string[] {
    const chunks: string[] = [];
    for (const { role, content } of turns) {
      const formatted = `${role}: ${content}`;
      if (formatted.length <= charLimit) {
        chunks.push(formatted);
        continue;
      }
      // Split oversized turns at paragraph breaks, then hard-cut if needed
      const prefix = `${role}: `;
      const paragraphs = content.split(/\n\n+/).filter((p) => p.trim() !== '');
      if (paragraphs.length === 0) {
        // All-whitespace oversized content: hard-cut as-is to avoid silent drop
        for (let i = 0; i < formatted.length; i += charLimit) {
          chunks.push(formatted.slice(i, i + charLimit));
        }
        continue;
      }
      let current = prefix;
      for (const para of paragraphs) {
        const addition = (current === prefix ? '' : '\n\n') + para;
        if (current.length + addition.length <= charLimit) {
          current += addition;
        } else {
          if (current !== prefix) {
            chunks.push(current);
          }
          // Hard-cut: prefix every slice so each chunk is self-contained
          const chunkContent = charLimit - prefix.length;
          for (let i = 0; i < para.length; i += chunkContent) {
            chunks.push(`${prefix}${para.slice(i, i + chunkContent)}`);
          }
          current = prefix;
        }
      }
      if (current !== prefix) {
        chunks.push(current);
      }
    }
    return chunks;
  }

  /**
   * Run async tasks with bounded concurrency (N at a time).
   * Each task is responsible for its own error handling; this helper does not
   * catch errors or preserve any result ordering.
   */
  private static async runConcurrent(
    tasks: Array<() => Promise<void>>,
    concurrency: number,
  ): Promise<void> {
    const queue = [...tasks];
    const workers = Array.from(
      { length: Math.min(concurrency, queue.length) },
      async () => {
        while (queue.length > 0) {
          const task = queue.shift();
          if (task) await task();
        }
      },
    );
    await Promise.all(workers);
  }

  /** Sort memories by importance score (descending), computed from metadata signals. */
  private sortByImportance(memories: Memory[]): Memory[] {
    if (!this.importanceService) {
      return memories;
    }
    const scored = memories.map((m) => ({
      memory: m,
      score: this.importanceService!.score({
        content: m.content,
        metadata: m.metadata,
        tags: m.tags,
        createdAt: m.createdAt,
      }).score,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.memory);
  }
}
