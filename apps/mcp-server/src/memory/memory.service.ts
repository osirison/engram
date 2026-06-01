import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MemoryStmService, StmMemoryNotFoundError } from '@engram/memory-stm';
import { MemoryLtmService, LtmMemoryNotFoundError } from '@engram/memory-ltm';
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
    metadata?: Record<string, unknown>;
    tags?: string[];
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
      tags?: string[];
      search?: string;
    },
  ) => Promise<MemoryListResult>;
  promote: (userId: string, memoryId: string) => Promise<Memory>;
  semanticSearch: (
    userId: string,
    query: string,
    options?: { limit?: number; scope?: string; tags?: string[] },
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
  metadata?: Record<string, unknown>;
  tags?: string[];
  ttl?: number;
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
  tags?: string[];
  search?: string;
}

export interface RecallOptions {
  limit?: number;
  scope?: string;
  tags?: string[];
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

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  private readonly stm: StmServiceContract;
  private readonly ltm: LtmServiceContract;

  constructor(
    private readonly stmService: MemoryStmService,
    private readonly ltmService: MemoryLtmService,
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
        metadata: dto.metadata,
        tags: dto.tags,
        ttl: dto.ttl,
      });
    } else {
      // Create long-term memory
      return await this.ltm.create({
        userId: dto.userId,
        content: dto.content,
        metadata: dto.metadata,
        tags: dto.tags,
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
}
