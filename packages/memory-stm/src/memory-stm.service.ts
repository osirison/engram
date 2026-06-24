import { Injectable, Logger, Optional } from '@nestjs/common';
import { RedisService } from '@engram/redis';
import { EmbeddingsService } from '@engram/embeddings';
import {
  StmMemory,
  StmConfig,
  CreateStmMemoryData,
  UpdateStmMemoryData,
  ListStmOptionsData,
  PaginatedResult,
  StmKeyBuilder,
  StmMemoryNotFoundError,
  StmMemoryExpiredError,
  StmTtlValidationError,
  DEFAULT_STM_CONFIG,
  createStmMemorySchema,
  updateStmMemorySchema,
} from './types';
import { randomUUID } from 'crypto';

@Injectable()
export class MemoryStmService {
  private readonly logger = new Logger(MemoryStmService.name);
  private readonly keyBuilder: StmKeyBuilder;
  private readonly config: StmConfig;

  constructor(
    private readonly redisService: RedisService,
    @Optional() private readonly embeddingsService?: EmbeddingsService
  ) {
    this.config = { ...DEFAULT_STM_CONFIG };
    this.keyBuilder = new StmKeyBuilder(this.config.keyPrefix);
  }

  /**
   * Create a new short-term memory
   */
  async create(input: CreateStmMemoryData): Promise<StmMemory> {
    this.logger.debug(`Creating STM memory for user: ${input.userId}`);

    // Validate input
    const validatedInput = createStmMemorySchema.parse(input);

    // Apply default TTL if not provided
    const ttl = validatedInput.ttl ?? this.config.defaultTtl;
    this.validateTtl(ttl);

    // Generate memory ID
    const memoryId = randomUUID();
    const expiresAt = new Date(Date.now() + ttl * 1000);

    // Generate embedding (non-fatal — memory creation succeeds even if this
    // fails or the API key is absent).
    let embedding: number[] = [];
    if (this.embeddingsService) {
      const result = await this.embeddingsService
        .generate({ text: validatedInput.content })
        .catch(() => null);
      embedding = result?.embedding ?? [];
    }

    // Create memory object
    const memory: StmMemory = {
      id: memoryId,
      userId: validatedInput.userId,
      organizationId: validatedInput.organizationId,
      scope: validatedInput.scope,
      content: validatedInput.content,
      metadata: validatedInput.metadata || null,
      tags: validatedInput.tags || [],
      type: 'short-term',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt,
      ttl,
      embedding,
      accessCount: 0,
    };

    // Store in Redis with TTL
    const redisKey = this.keyBuilder.buildMemoryKey(
      validatedInput.userId,
      memoryId,
      validatedInput.organizationId
    );
    const redisValue = JSON.stringify(memory);

    await this.redisService.set(redisKey, redisValue, ttl);

    this.logger.debug(`STM memory created: ${memoryId}, expires at: ${expiresAt.toISOString()}`);
    return memory;
  }

  /**
   * Retrieve a short-term memory by ID
   */
  async findById(
    userId: string,
    memoryId: string,
    organizationId?: string,
    scope?: string
  ): Promise<StmMemory> {
    this.logger.debug(`Finding STM memory: ${memoryId} for user: ${userId}`);

    const redisKey = this.keyBuilder.buildMemoryKey(userId, memoryId, organizationId);
    const redisValue = await this.redisService.get(redisKey);

    if (!redisValue) {
      throw new StmMemoryNotFoundError(memoryId);
    }

    // Narrow the parse error so Redis/network failures later in this method
    // are not silently converted to StmMemoryNotFoundError.
    let memory: StmMemory;
    try {
      memory = this.deserializeStmMemory(JSON.parse(redisValue));
    } catch {
      this.logger.error(`Failed to parse STM memory ${memoryId}`);
      throw new StmMemoryNotFoundError(memoryId);
    }

    // Check if memory has expired (additional safety check)
    if (memory.expiresAt && new Date() > new Date(memory.expiresAt)) {
      await this.redisService.del(redisKey);
      throw new StmMemoryExpiredError(memoryId);
    }

    // Enforce scope isolation: treat a scope mismatch as not-found.
    if (scope !== undefined && memory.scope !== scope) {
      throw new StmMemoryNotFoundError(memoryId);
    }

    // Increment access counter and persist back to Redis.
    // We read the remaining TTL first so the SET doesn't silently remove
    // the expiry. Under concurrent reads the count may be under-reported by
    // at most (readers - 1), which is acceptable for a promotion heuristic.
    const updatedMemory: StmMemory = { ...memory, accessCount: (memory.accessCount ?? 0) + 1 };
    const remainingTtl = await this.redisService.ttl(redisKey);
    if (remainingTtl > 0) {
      await this.redisService.set(redisKey, JSON.stringify(updatedMemory), remainingTtl);
    }

    return updatedMemory;
  }

  /**
   * Update a short-term memory
   */
  async update(
    userId: string,
    memoryId: string,
    input: UpdateStmMemoryData,
    organizationId?: string,
    scope?: string
  ): Promise<StmMemory> {
    this.logger.debug(`Updating STM memory: ${memoryId} for user: ${userId}`);

    // Validate input
    const validatedInput = updateStmMemorySchema.parse(input);

    // Get existing memory (must use same org scope to find the key). Passing
    // scope enforces namespace isolation — a mismatch surfaces as not-found.
    const existing = await this.findById(userId, memoryId, organizationId, scope);

    // Validate new TTL if provided
    const newTtl = validatedInput.ttl ?? existing.ttl;
    this.validateTtl(newTtl);

    // Calculate new expiration time
    const now = new Date();
    const expiresAt = new Date(now.getTime() + newTtl * 1000);

    // Update memory object
    const updatedMemory: StmMemory = {
      ...existing,
      content: validatedInput.content ?? existing.content,
      metadata: validatedInput.metadata !== undefined ? validatedInput.metadata : existing.metadata,
      tags: validatedInput.tags ?? existing.tags,
      updatedAt: now,
      expiresAt,
      ttl: newTtl,
    };

    // Store updated memory in Redis with new TTL
    const redisKey = this.keyBuilder.buildMemoryKey(userId, memoryId, organizationId);
    const redisValue = JSON.stringify(updatedMemory);

    await this.redisService.set(redisKey, redisValue, newTtl);

    this.logger.debug(`STM memory updated: ${memoryId}, new expiry: ${expiresAt.toISOString()}`);
    return updatedMemory;
  }

  /**
   * Delete a short-term memory
   */
  async delete(
    userId: string,
    memoryId: string,
    organizationId?: string,
    scope?: string
  ): Promise<void> {
    this.logger.debug(`Deleting STM memory: ${memoryId} for user: ${userId}`);

    const redisKey = this.keyBuilder.buildMemoryKey(userId, memoryId, organizationId);

    // Scope isolation: the Redis key does not encode scope, so when a scope is
    // supplied we must read the record and verify it before deleting. A mismatch
    // is treated as not-found so a caller bound to one namespace cannot delete
    // another's memory.
    if (scope !== undefined) {
      const raw = await this.redisService.get(redisKey);
      if (!raw) {
        throw new StmMemoryNotFoundError(memoryId);
      }
      let memory: StmMemory;
      try {
        memory = this.deserializeStmMemory(JSON.parse(raw));
      } catch {
        throw new StmMemoryNotFoundError(memoryId);
      }
      if (memory.scope !== scope) {
        throw new StmMemoryNotFoundError(memoryId);
      }
    }

    const deleted = await this.redisService.del(redisKey);

    if (deleted === 0) {
      throw new StmMemoryNotFoundError(memoryId);
    }

    this.logger.debug(`STM memory deleted: ${memoryId}`);
  }

  /**
   * List short-term memories for a user with pagination and filtering
   */
  async list(
    userId: string,
    options: Partial<ListStmOptionsData> = {}
  ): Promise<PaginatedResult<StmMemory>> {
    this.logger.debug(`Listing STM memories for user: ${userId}`);

    const limit = options.limit || 20;
    const cursor = options.cursor || '0';
    const tags = options.tags || [];
    const scope = options.scope;
    const pattern = this.keyBuilder.buildUserPattern(userId, options.organizationId);

    // Use Redis SCAN for memory-efficient iteration
    const scanResult = await this.redisService.scan(cursor, {
      match: pattern,
      count: limit * 2, // Get extra keys to account for filtering
    });

    const keys = scanResult.keys;
    const memories: StmMemory[] = [];

    if (keys.length > 0) {
      // Fetch memory data for found keys using pipeline
      const pipeline = this.redisService.pipeline();
      keys.forEach((key) => pipeline.get(key));
      const results = await pipeline.exec();

      if (results) {
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          if (!result) continue;

          const [error, data] = result;
          if (!error && data) {
            try {
              const memory = this.deserializeStmMemory(JSON.parse(data as string));

              // Apply tag filtering if tags are provided
              if (tags.length > 0) {
                const hasMatchingTag = tags.some((tag) => memory.tags.includes(tag));
                if (!hasMatchingTag) continue;
              }

              // Apply scope filtering if scope is provided
              if (scope !== undefined && memory.scope !== scope) continue;

              memories.push(memory);
              if (memories.length >= limit) break;
            } catch {
              this.logger.warn(`Failed to parse STM memory from key: ${keys[i]}`);
            }
          }
        }
      }
    }

    // Get total count for pagination metadata
    const totalCount = await this.count(userId, {
      tags,
      organizationId: options.organizationId,
      scope,
    });

    return {
      items: memories,
      totalCount,
      hasNextPage: scanResult.cursor !== '0',
      hasPreviousPage: cursor !== '0',
      startCursor: cursor,
      endCursor: scanResult.cursor,
    };
  }

  /**
   * Get the remaining TTL for a memory
   */
  async getTtl(userId: string, memoryId: string, organizationId?: string): Promise<number> {
    this.logger.debug(`Getting TTL for STM memory: ${memoryId}`);

    const redisKey = this.keyBuilder.buildMemoryKey(userId, memoryId, organizationId);
    const ttl = await this.redisService.ttl(redisKey);

    if (ttl === -2) {
      throw new StmMemoryNotFoundError(memoryId);
    }

    if (ttl === -1) {
      // Key exists but has no expiration (shouldn't happen for STM)
      this.logger.warn(`STM memory ${memoryId} has no TTL set`);
      return 0;
    }

    return ttl;
  }

  /**
   * Extend TTL for a memory
   */
  async extendTtl(
    userId: string,
    memoryId: string,
    additionalSeconds: number,
    organizationId?: string
  ): Promise<StmMemory> {
    this.logger.debug(`Extending TTL for STM memory: ${memoryId} by ${additionalSeconds} seconds`);

    // Get existing memory
    const existing = await this.findById(userId, memoryId, organizationId);

    // Calculate new TTL
    const currentTtl = await this.getTtl(userId, memoryId, organizationId);
    const newTtl = currentTtl + additionalSeconds;

    this.validateTtl(newTtl);

    // Update memory with new TTL
    return this.update(
      userId,
      memoryId,
      {
        ttl: newTtl,
        tags: existing.tags, // Preserve existing tags value (tags is optional in schema)
      },
      organizationId
    );
  }

  /**
   * Count total memories for a user with optional tag and scope filtering
   */
  async count(
    userId: string,
    options: { tags?: string[]; organizationId?: string; scope?: string } = {}
  ): Promise<number> {
    this.logger.debug(`Counting STM memories for user: ${userId}`);

    const pattern = this.keyBuilder.buildUserPattern(userId, options.organizationId);
    const tags = options.tags || [];
    const scope = options.scope;
    const needsPayloadScan = tags.length > 0 || scope !== undefined;
    let cursor = '0';
    let count = 0;

    do {
      const scanResult = await this.redisService.scan(cursor, {
        match: pattern,
        count: 1000, // Process in batches
      });

      if (needsPayloadScan) {
        // Need to fetch payloads to apply tag/scope filtering
        const keys = scanResult.keys;
        if (keys.length > 0) {
          const pipeline = this.redisService.pipeline();
          keys.forEach((key) => pipeline.get(key));
          const results = await pipeline.exec();

          if (results) {
            for (const [error, data] of results) {
              if (!error && data) {
                try {
                  const memory = this.deserializeStmMemory(JSON.parse(data as string));
                  if (tags.length > 0) {
                    const hasMatchingTag = tags.some((tag) => memory.tags.includes(tag));
                    if (!hasMatchingTag) continue;
                  }
                  if (scope !== undefined && memory.scope !== scope) continue;
                  count++;
                } catch {
                  // Skip invalid entries
                  this.logger.warn(`Failed to parse STM memory during count`);
                }
              }
            }
          }
        }
      } else {
        // Simple count without payload filtering
        count += scanResult.keys.length;
      }

      cursor = scanResult.cursor;
    } while (cursor !== '0');

    return count;
  }

  /**
   * Clear all memories for a user, optionally scoped to an organization.
   */
  async clear(userId: string, organizationId?: string): Promise<number> {
    this.logger.debug(`Clearing all STM memories for user: ${userId}`);

    const pattern = this.keyBuilder.buildUserPattern(userId, organizationId);
    let cursor = '0';
    let deletedCount = 0;

    do {
      const scanResult = await this.redisService.scan(cursor, {
        match: pattern,
        count: 1000, // Process in batches
      });

      const keys = scanResult.keys;
      if (keys.length > 0) {
        // Delete in batches for efficiency
        const deleteResult = await this.redisService.delMany(keys);
        deletedCount += deleteResult;
      }

      cursor = scanResult.cursor;
    } while (cursor !== '0');

    this.logger.debug(`Cleared ${deletedCount} STM memories for user: ${userId}`);
    return deletedCount;
  }

  /**
   * Scan STM memories and return those whose access count meets or exceeds the
   * given threshold.  Optionally scoped to a single user; omitting `userId`
   * scans all users.  Used by the consolidation job to identify promotion
   * candidates without coupling the scheduler to per-user iteration logic.
   *
   * NOTE: when `userId` is provided the scan uses `buildUserPattern(userId)` which
   * only matches personal (non-org) keys. Org-scoped memories for that user are
   * still found by the global scan (`userId` omitted) used by the consolidation
   * service.
   *
   * @param threshold - Minimum accessCount required for a memory to qualify.
   * @param userId    - When provided, restrict the scan to this user only (personal keys).
   */
  async findCandidates(threshold: number, userId?: string): Promise<StmMemory[]> {
    if (!Number.isFinite(threshold) || threshold <= 0) {
      throw new Error(
        `Invalid consolidation threshold: ${threshold}. Must be a positive finite number.`
      );
    }

    this.logger.debug(`Scanning for consolidation candidates (threshold=${threshold})`);

    const pattern = userId
      ? this.keyBuilder.buildUserPattern(userId)
      : this.keyBuilder.buildGlobalPattern();
    let cursor = '0';
    const candidates: StmMemory[] = [];

    do {
      const scanResult = await this.redisService.scan(cursor, {
        match: pattern,
        count: 1000,
      });

      if (scanResult.keys.length > 0) {
        const pipeline = this.redisService.pipeline();
        scanResult.keys.forEach((key) => pipeline.get(key));
        const results = await pipeline.exec();

        if (results) {
          for (const [error, data] of results) {
            if (!error && data) {
              try {
                const memory = this.deserializeStmMemory(JSON.parse(data as string));
                if ((memory.accessCount ?? 0) >= threshold) {
                  candidates.push(memory);
                }
              } catch {
                this.logger.warn('Failed to parse STM memory during candidate scan');
              }
            }
          }
        }
      }

      cursor = scanResult.cursor;
    } while (cursor !== '0');

    this.logger.debug(`Found ${candidates.length} consolidation candidate(s)`);
    return candidates;
  }

  private deserializeStmMemory(raw: unknown): StmMemory {
    const m = raw as StmMemory;
    return {
      ...m,
      createdAt: new Date(m.createdAt),
      updatedAt: new Date(m.updatedAt),
      expiresAt: new Date(m.expiresAt),
    };
  }

  /**
   * Validate TTL value
   */
  private validateTtl(ttl: number): void {
    if (ttl < this.config.minTtl || ttl > this.config.maxTtl) {
      throw new StmTtlValidationError(ttl, this.config.minTtl, this.config.maxTtl);
    }
  }
}
