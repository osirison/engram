import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@engram/redis';
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
    config?: Partial<StmConfig>
  ) {
    this.config = { ...DEFAULT_STM_CONFIG, ...config };
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

    // Create memory object
    const memory: StmMemory = {
      id: memoryId,
      userId: validatedInput.userId,
      content: validatedInput.content,
      metadata: validatedInput.metadata || null,
      tags: validatedInput.tags || [],
      type: 'short-term',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt,
      ttl,
    };

    // Store in Redis with TTL
    const redisKey = this.keyBuilder.buildMemoryKey(validatedInput.userId, memoryId);
    const redisValue = JSON.stringify(memory);

    await this.redisService.set(redisKey, redisValue, ttl);

    this.logger.debug(`STM memory created: ${memoryId}, expires at: ${expiresAt.toISOString()}`);
    return memory;
  }

  /**
   * Retrieve a short-term memory by ID
   */
  async findById(userId: string, memoryId: string): Promise<StmMemory> {
    this.logger.debug(`Finding STM memory: ${memoryId} for user: ${userId}`);

    const redisKey = this.keyBuilder.buildMemoryKey(userId, memoryId);
    const redisValue = await this.redisService.get(redisKey);

    if (!redisValue) {
      throw new StmMemoryNotFoundError(memoryId);
    }

    try {
      const memory: StmMemory = JSON.parse(redisValue);
      
      // Check if memory has expired (additional safety check)
      if (memory.expiresAt && new Date() > new Date(memory.expiresAt)) {
        await this.redisService.del(redisKey);
        throw new StmMemoryExpiredError(memoryId);
      }

      return memory;
    } catch (error) {
      if (error instanceof StmMemoryExpiredError) {
        throw error;
      }
      this.logger.error(`Failed to parse STM memory ${memoryId}: ${error}`);
      throw new StmMemoryNotFoundError(memoryId);
    }
  }

  /**
   * Update a short-term memory
   */
  async update(userId: string, memoryId: string, input: UpdateStmMemoryData): Promise<StmMemory> {
    this.logger.debug(`Updating STM memory: ${memoryId} for user: ${userId}`);

    // Validate input
    const validatedInput = updateStmMemorySchema.parse(input);

    // Get existing memory
    const existing = await this.findById(userId, memoryId);

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
    const redisKey = this.keyBuilder.buildMemoryKey(userId, memoryId);
    const redisValue = JSON.stringify(updatedMemory);

    await this.redisService.set(redisKey, redisValue, newTtl);

    this.logger.debug(`STM memory updated: ${memoryId}, new expiry: ${expiresAt.toISOString()}`);
    return updatedMemory;
  }

  /**
   * Delete a short-term memory
   */
  async delete(userId: string, memoryId: string): Promise<void> {
    this.logger.debug(`Deleting STM memory: ${memoryId} for user: ${userId}`);

    const redisKey = this.keyBuilder.buildMemoryKey(userId, memoryId);
    const deleted = await this.redisService.del(redisKey);

    if (deleted === 0) {
      throw new StmMemoryNotFoundError(memoryId);
    }

    this.logger.debug(`STM memory deleted: ${memoryId}`);
  }

  /**
   * List short-term memories for a user with pagination and filtering
   */
  async list(userId: string, options: Partial<ListStmOptionsData> = {}): Promise<PaginatedResult<StmMemory>> {
    this.logger.debug(`Listing STM memories for user: ${userId}`);

    const limit = options.limit || 20;
    const cursor = options.cursor || '0';
    const tags = options.tags || [];
    const pattern = this.keyBuilder.buildUserPattern(userId);

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
      keys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();

      if (results) {
        for (const [error, data] of results) {
          if (!error && data) {
            try {
              const memory = JSON.parse(data as string) as StmMemory;

              // Apply tag filtering if tags are provided
              if (tags.length > 0) {
                const hasMatchingTag = tags.some(tag => 
                  memory.tags.includes(tag)
                );
                if (!hasMatchingTag) continue;
              }

              memories.push(memory);
              if (memories.length >= limit) break;
            } catch {
              this.logger.warn(`Failed to parse STM memory from key: ${keys[results.indexOf([error, data])]}`);
            }
          }
        }
      }
    }

    // Get total count for pagination metadata
    const totalCount = await this.count(userId, { tags });

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
  async getTtl(userId: string, memoryId: string): Promise<number> {
    this.logger.debug(`Getting TTL for STM memory: ${memoryId}`);

    const redisKey = this.keyBuilder.buildMemoryKey(userId, memoryId);
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
  async extendTtl(userId: string, memoryId: string, additionalSeconds: number): Promise<StmMemory> {
    this.logger.debug(`Extending TTL for STM memory: ${memoryId} by ${additionalSeconds} seconds`);

    // Get existing memory
    const existing = await this.findById(userId, memoryId);
    
    // Calculate new TTL
    const currentTtl = await this.getTtl(userId, memoryId);
    const newTtl = currentTtl + additionalSeconds;
    
    this.validateTtl(newTtl);

    // Update memory with new TTL
    return this.update(userId, memoryId, { 
      ttl: newTtl,
      tags: existing.tags // Preserve existing tags value (tags is optional in schema)
    });
  }

  /**
   * Count total memories for a user with optional tag filtering
   */
  async count(userId: string, options: { tags?: string[] } = {}): Promise<number> {
    this.logger.debug(`Counting STM memories for user: ${userId}`);

    const pattern = this.keyBuilder.buildUserPattern(userId);
    const tags = options.tags || [];
    let cursor = '0';
    let count = 0;

    do {
      const scanResult = await this.redisService.scan(cursor, {
        match: pattern,
        count: 1000, // Process in batches
      });

      if (tags.length > 0) {
        // Need to check tag filtering - fetch and count
        const keys = scanResult.keys;
        if (keys.length > 0) {
          const pipeline = this.redisService.pipeline();
          keys.forEach(key => pipeline.get(key));
          const results = await pipeline.exec();

          if (results) {
            for (const [error, data] of results) {
              if (!error && data) {
                try {
                  const memory = JSON.parse(data as string) as StmMemory;
                  const hasMatchingTag = tags.some(tag => 
                    memory.tags.includes(tag)
                  );
                  if (hasMatchingTag) count++;
                } catch {
                  // Skip invalid entries
                  this.logger.warn(`Failed to parse STM memory during count`);
                }
              }
            }
          }
        }
      } else {
        // Simple count without tag filtering
        count += scanResult.keys.length;
      }

      cursor = scanResult.cursor;
    } while (cursor !== '0');

    return count;
  }

  /**
   * Clear all memories for a user
   */
  async clear(userId: string): Promise<number> {
    this.logger.debug(`Clearing all STM memories for user: ${userId}`);

    const pattern = this.keyBuilder.buildUserPattern(userId);
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
   * Validate TTL value
   */
  private validateTtl(ttl: number): void {
    if (ttl < this.config.minTtl || ttl > this.config.maxTtl) {
      throw new StmTtlValidationError(ttl, this.config.minTtl, this.config.maxTtl);
    }
  }
}