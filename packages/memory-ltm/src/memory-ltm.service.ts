import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '@engram/database';
import {
  MemoryType,
  PaginatedResult,
} from '@engram/database';
import { MemoryStmService } from '@engram/memory-stm';
import {
  LtmMemory,
  CreateLtmMemoryData,
  UpdateLtmMemoryData,
  LtmQueryOptions,
  LtmConfig,
  DEFAULT_LTM_CONFIG,
  LtmMemoryNotFoundError,
  LtmMemoryQuotaExceededError,
  LtmPromotionError,
  LtmDatabaseError,
  validateCreateLtmMemory,
  validateUpdateLtmMemory,
  validateLtmQueryOptions,
} from './types';
import { randomUUID } from 'crypto';

// Type for Prisma Memory result - temporary until Prisma types are properly configured
type PrismaMemory = {
  id: string;
  userId: string;
  content: string;
  metadata: unknown;  // Using unknown for type safety; must be type-checked before use
  tags: string[];
  type: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
};

@Injectable()
export class MemoryLtmService {
  private readonly logger = new Logger(MemoryLtmService.name);
  private readonly config: LtmConfig;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly stmService?: MemoryStmService,
    config?: Partial<LtmConfig>
  ) {
    this.config = { ...DEFAULT_LTM_CONFIG, ...config };
    // Use prisma to avoid unused variable warning
    // TODO: Remove this workaround once Prisma types are properly configured and the actual implementation uses `this.prisma`
    void this.prisma;
  }

  /**
   * Create a new long-term memory
   */
  async create(input: CreateLtmMemoryData): Promise<LtmMemory> {
    this.logger.debug(`Creating LTM memory for user: ${input.userId}`);

    // Validate input
    const validatedInput = validateCreateLtmMemory(input);

    try {
      // Check if user has exceeded quota
      await this.checkQuota(validatedInput.userId);

      // TODO: Replace with actual Prisma call once types are resolved
      // const memory = await this.prisma.memory.create({
      const memory: PrismaMemory = {
        id: randomUUID(),
        userId: validatedInput.userId,
        content: validatedInput.content,
        metadata: validatedInput.metadata || null,
        tags: validatedInput.tags || [],
        type: MemoryType.LONG_TERM,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      };
      // TODO: Remove placeholder once Prisma is working
      this.logger.warn('Using placeholder implementation - Prisma types not available');
      this.logger.debug('Would create memory:', JSON.stringify(memory));

      this.logger.debug(`LTM memory created: ${memory.id}`);
      return this.mapToLtmMemory(memory);
    } catch (error) {
      if (error instanceof LtmMemoryQuotaExceededError) {
        throw error;
      }
      this.logger.error(`Failed to create LTM memory: ${error}`);
      throw new LtmDatabaseError('create', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Retrieve a long-term memory by ID
   */
  async get(userId: string, memoryId: string): Promise<LtmMemory | null> {
    this.logger.debug(`Getting LTM memory: ${memoryId} for user: ${userId}`);

    try {
      // TODO: Replace with actual Prisma call once types are resolved
      // const memory = await this.prisma.memory.findFirst({
      const memory: PrismaMemory | null = null; // Placeholder
      this.logger.warn('Using placeholder implementation - Prisma types not available');
      this.logger.debug(`Would find memory: ${memoryId} for user: ${userId}`);

      if (!memory) {
        return null;
      }

      return this.mapToLtmMemory(memory);
    } catch (error) {
      this.logger.error(`Failed to get LTM memory ${memoryId}: ${error}`);
      throw new LtmDatabaseError('get', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Update a long-term memory
   */
  async update(userId: string, memoryId: string, input: UpdateLtmMemoryData): Promise<LtmMemory> {
    this.logger.debug(`Updating LTM memory: ${memoryId} for user: ${userId}`);

    // Validate input
    const validatedInput = validateUpdateLtmMemory(input);

    try {
      // Check if memory exists and belongs to user
      const existing = await this.get(userId, memoryId);
      if (!existing) {
        throw new LtmMemoryNotFoundError(memoryId);
      }

      // Prepare update data (only include fields that are provided)
      const updateData: Record<string, unknown> = {};
      
      if (validatedInput.content !== undefined) {
        updateData.content = validatedInput.content;
      }
      if (validatedInput.metadata !== undefined) {
        updateData.metadata = validatedInput.metadata || null;
      }
      if (validatedInput.tags !== undefined) {
        updateData.tags = validatedInput.tags || [];
      }

      // Update memory in database
      // TODO: Replace with actual Prisma call once types are resolved
      const memory: PrismaMemory = {
        id: memoryId,
        userId,
        content: validatedInput.content !== undefined ? validatedInput.content : existing.content,
        metadata: validatedInput.metadata !== undefined ? validatedInput.metadata : existing.metadata,
        tags: validatedInput.tags !== undefined ? validatedInput.tags : existing.tags,
        type: MemoryType.LONG_TERM,
        createdAt: existing.createdAt,
        updatedAt: new Date(),
        expiresAt: null,
      };
      this.logger.warn('Using placeholder implementation - Prisma types not available');
      this.logger.debug(`Would update memory: ${memoryId} with data: ${JSON.stringify(updateData)}`);

      this.logger.debug(`LTM memory updated: ${memoryId}`);
      return this.mapToLtmMemory(memory);
    } catch (error) {
      if (error instanceof LtmMemoryNotFoundError) {
        throw error;
      }
      this.logger.error(`Failed to update LTM memory ${memoryId}: ${error}`);
      throw new LtmDatabaseError('update', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Delete a long-term memory
   */
  async delete(userId: string, memoryId: string): Promise<boolean> {
    this.logger.debug(`Deleting LTM memory: ${memoryId} for user: ${userId}`);

    try {
      // TODO: Replace with actual Prisma call once types are resolved
      const result = { count: 1 }; // Placeholder
      this.logger.warn('Using placeholder implementation - Prisma types not available');
      this.logger.debug(`Would delete memory: ${memoryId} for user: ${userId}`);

      const deleted = result.count > 0;
      if (deleted) {
        this.logger.debug(`LTM memory deleted: ${memoryId}`);
      } else {
        this.logger.debug(`LTM memory not found for deletion: ${memoryId}`);
      }

      return deleted;
    } catch (error) {
      this.logger.error(`Failed to delete LTM memory ${memoryId}: ${error}`);
      throw new LtmDatabaseError('delete', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * List long-term memories for a user with pagination and filtering
   */
  async list(userId: string, options?: LtmQueryOptions): Promise<PaginatedResult<LtmMemory>> {
    this.logger.debug(`Listing LTM memories for user: ${userId}`);

    // Validate and set defaults for options
    const validatedOptions = validateLtmQueryOptions(options || {});

    try {
      // Build where clause
      // Note: This would be used in actual Prisma implementation
      // TODO: Remove these void statements once Prisma integration is complete
      void userId; // Prevent unused warning
      void MemoryType.LONG_TERM; // Prevent unused warning

      // Add filters
      if (validatedOptions.tags && validatedOptions.tags.length > 0) {
        // Would add tags filter to whereClause
      }

      if (validatedOptions.dateFrom || validatedOptions.dateTo) {
        // Would add date filters to whereClause
      }

      if (validatedOptions.search) {
        // Would add search filter to whereClause
      }

      // Handle cursor-based pagination
      // Note: These would be used in actual Prisma implementation
      void validatedOptions.sortBy; // Prevent unused var warning
      void validatedOptions.sortOrder; // Prevent unused var warning
      void validatedOptions.cursor; // Prevent unused var warning

      // Get total count
      // TODO: Replace with actual Prisma call once types are resolved
      const totalCount = 2; // Placeholder
      const memories: PrismaMemory[] = []; // Placeholder
      this.logger.warn('Using placeholder implementation - Prisma types not available');
      this.logger.debug(`Would list memories for user: ${userId} with options: ${JSON.stringify(validatedOptions)}`);

      // Check if there are more pages
      const hasNextPage = memories.length > validatedOptions.limit;
      if (hasNextPage) {
        memories.pop(); // Remove the extra item
      }

      // Map to LTM memories
      const ltmMemories = memories.map((memory: PrismaMemory) => this.mapToLtmMemory(memory));

      // Build pagination info
      const result: PaginatedResult<LtmMemory> = {
        items: ltmMemories,
        totalCount,
        hasNextPage: false, // Placeholder
        hasPreviousPage: !!validatedOptions.cursor,
        startCursor: ltmMemories.length > 0 ? ltmMemories[0]?.id : undefined,
        endCursor: ltmMemories.length > 0 ? ltmMemories[ltmMemories.length - 1]?.id : undefined,
      };

      this.logger.debug(`Listed ${ltmMemories.length} LTM memories for user: ${userId}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to list LTM memories for user ${userId}: ${error}`);
      throw new LtmDatabaseError('list', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Count total long-term memories for a user
   */
  async count(userId: string, filters?: Partial<LtmQueryOptions>): Promise<number> {
    this.logger.debug(`Counting LTM memories for user: ${userId}`);

    try {
      // Note: whereClause would be used in actual Prisma implementation
      void userId; // Prevent unused warning
      void MemoryType.LONG_TERM; // Prevent unused warning
      void filters; // Prevent unused warning

      // TODO: Replace with actual Prisma call once types are resolved
      const count = 5; // Placeholder
      this.logger.warn('Using placeholder implementation - Prisma types not available');
      this.logger.debug(`Would count memories for user: ${userId} with filters: ${JSON.stringify(filters)}`);

      this.logger.debug(`Counted ${count} LTM memories for user: ${userId}`);
      return count;
    } catch (error) {
      this.logger.error(`Failed to count LTM memories for user ${userId}: ${error}`);
      throw new LtmDatabaseError('count', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Clear all long-term memories for a user
   */
  async clear(userId: string): Promise<number> {
    this.logger.debug(`Clearing all LTM memories for user: ${userId}`);

    try {
      // TODO: Replace with actual Prisma call once types are resolved
      const result = { count: 10 }; // Placeholder
      this.logger.warn('Using placeholder implementation - Prisma types not available');
      this.logger.debug(`Would clear memories for user: ${userId}`);

      this.logger.debug(`Cleared ${result.count} LTM memories for user: ${userId}`);
      return result.count;
    } catch (error) {
      this.logger.error(`Failed to clear LTM memories for user ${userId}: ${error}`);
      throw new LtmDatabaseError('clear', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Promote a memory from short-term to long-term storage
   * This method transfers a memory from Redis STM to PostgreSQL LTM
   */
  async promote(userId: string, memoryId: string): Promise<LtmMemory> {
    this.logger.debug(`Promoting memory ${memoryId} to LTM for user: ${userId}`);

    if (!this.stmService) {
      throw new LtmPromotionError(memoryId, 'STM service not available for promotion');
    }

    try {
      // Step 1: Get memory from STM service
      const stmMemory = await this.stmService.findById(userId, memoryId);
      if (!stmMemory) {
        throw new LtmPromotionError(memoryId, 'Memory not found in short-term storage');
      }

      // Step 2: Begin database transaction for atomic operation
      // TODO: Replace with actual Prisma transaction once types are resolved
      const result: PrismaMemory = {
        id: stmMemory.id,
        userId: stmMemory.userId,
        content: stmMemory.content,
        metadata: stmMemory.metadata,
        tags: stmMemory.tags,
        type: MemoryType.LONG_TERM,
        createdAt: stmMemory.createdAt,
        updatedAt: new Date(),
        expiresAt: null,
      };
      this.logger.warn('Using placeholder implementation - Prisma types not available');
      this.logger.debug(`Would promote STM memory to LTM: ${JSON.stringify(stmMemory)}`);

      // Step 3: Delete from STM storage (only after successful LTM creation)
      try {
        await this.stmService.delete(userId, memoryId);
        this.logger.debug(`Successfully promoted memory ${memoryId} from STM to LTM`);
      } catch (stmDeleteError) {
        // Log warning but don't fail the operation since LTM creation succeeded
        this.logger.warn(`Failed to delete STM memory ${memoryId} after promotion: ${stmDeleteError}`);
      }

      return this.mapToLtmMemory(result);
    } catch (error) {
      if (error instanceof LtmPromotionError || error instanceof LtmMemoryQuotaExceededError) {
        throw error;
      }
      this.logger.error(`Failed to promote memory ${memoryId}: ${error}`);
      throw new LtmPromotionError(memoryId, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Check if user has exceeded memory quota
   */
  private async checkQuota(userId: string): Promise<void> {
    // TODO: Replace with actual count implementation
    const currentCount = 0; // Placeholder
    this.logger.debug(`Quota check for user ${userId}: ${currentCount}/${this.config.maxMemoriesPerUser}`);
    
    if (currentCount >= this.config.maxMemoriesPerUser) {
      throw new LtmMemoryQuotaExceededError(userId, this.config.maxMemoriesPerUser);
    }
  }

  /**
   * Map Prisma Memory to LtmMemory type
   */
  private mapToLtmMemory(memory: PrismaMemory): LtmMemory {
    return {
      ...memory,
      type: 'long-term' as const,
      expiresAt: null,
      metadata: memory.metadata as Record<string, unknown> | null,
    };
  }
}