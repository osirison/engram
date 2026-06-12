import { Controller, Injectable, Logger } from '@nestjs/common';
import type { Tool } from '@engram/core';
import {
  MemoryService,
  CreateMemoryDto,
  UpdateMemoryDto,
} from './memory.service';
import {
  createMemoryToolSchema,
  CreateMemoryToolInput,
} from './dto/create-memory.dto';
import { getMemoryToolSchema, GetMemoryToolInput } from './dto/get-memory.dto';
import {
  listMemoriesToolSchema,
  ListMemoriesToolInput,
} from './dto/list-memories.dto';
import {
  updateMemoryToolSchema,
  UpdateMemoryToolInput,
} from './dto/update-memory.dto';
import { recallToolSchema, RecallToolInput } from './dto/recall.dto';
import { reindexToolSchema, ReindexToolInput } from './dto/reindex.dto';
import {
  reindexQueueToolSchema,
  ReindexQueueToolInput,
  reindexStatusToolSchema,
  ReindexStatusToolInput,
  reindexCancelToolSchema,
  ReindexCancelToolInput,
  reindexRetryToolSchema,
  ReindexRetryToolInput,
} from './dto/reindex-job.dto';
import { ReindexQueueService } from './reindex-queue.service';

/**
 * MCP Memory Tools Controller
 *
 * Implements 12 MCP tools for memory management:
 * 1. create_memory - Create short-term or long-term memory
 * 2. get_memory - Retrieve memory by ID
 * 3. list_memories - List memories with pagination
 * 4. update_memory - Update existing memory
 * 5. delete_memory - Delete memory by ID
 * 6. promote_memory - Convert STM memory to LTM
 * 7. recall - Semantic (vector) recall over long-term memories
 * 8. reindex_memories - Backfill/rebuild the vector store from Postgres
 * 9. queue_reindex_memories - Queue resumable reindex processing as a job
 * 10. get_reindex_status - Poll queued reindex progress by job id
 * 11. cancel_reindex_job - Request cancellation for a queued/running job
 * 12. retry_reindex_job - Retry a failed/cancelled job from its last cursor
 */
@Controller('memory')
@Injectable()
export class MemoryController {
  private readonly logger = new Logger(MemoryController.name);

  constructor(
    private readonly memoryService: MemoryService,
    private readonly reindexQueue: ReindexQueueService,
  ) {}

  private assertAdminAuthorized(adminToken: string): void {
    const expected = process.env.MCP_ADMIN_TOKEN;
    if (!expected) {
      throw new Error('MCP_ADMIN_TOKEN is not configured');
    }
    if (adminToken !== expected) {
      throw new Error('Unauthorized maintenance operation');
    }
  }

  /**
   * MCP Tool: create_memory
   * Create a new memory in short-term or long-term storage
   */
  async createMemory(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('create_memory tool called');

      // Validate input using Zod schema
      const validatedInput: CreateMemoryToolInput =
        createMemoryToolSchema.parse(input);

      // Convert to service DTO
      const createDto: CreateMemoryDto = {
        userId: validatedInput.userId,
        content: validatedInput.content,
        type: validatedInput.type,
        metadata: validatedInput.metadata,
        tags: validatedInput.tags,
        ttl: validatedInput.ttl,
      };

      // Create memory using service
      const memory = await this.memoryService.createMemory(createDto);

      return {
        content: [
          {
            type: 'text',
            text: `Created ${memory.type} memory with ID: ${memory.id}`,
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in create_memory tool:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to create memory: ${errorMessage}`);
    }
  }

  /**
   * MCP Tool: get_memory
   * Retrieve memory by ID
   */
  async getMemory(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('get_memory tool called');

      // Validate input using Zod schema
      const validatedInput: GetMemoryToolInput =
        getMemoryToolSchema.parse(input);

      // Get memory using service
      const memory = await this.memoryService.getMemory(
        validatedInput.userId,
        validatedInput.memoryId,
      );

      if (!memory) {
        return {
          content: [
            {
              type: 'text',
              text: `Memory ${validatedInput.memoryId} not found`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(memory, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in get_memory tool:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to get memory: ${errorMessage}`);
    }
  }

  /**
   * MCP Tool: list_memories
   * List memories with pagination and filtering
   */
  async listMemories(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('list_memories tool called');

      // Validate input using Zod schema
      const validatedInput: ListMemoriesToolInput =
        listMemoriesToolSchema.parse(input);

      // List memories using service
      const result = await this.memoryService.listMemories(
        validatedInput.userId,
        {
          limit: validatedInput.limit,
          cursor: validatedInput.cursor,
          tags: validatedInput.tags,
          search: validatedInput.search,
        },
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                memories: result.items,
                pagination: {
                  totalCount: result.totalCount,
                  hasNextPage: result.hasNextPage,
                  hasPreviousPage: result.hasPreviousPage,
                  startCursor: result.startCursor,
                  endCursor: result.endCursor,
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in list_memories tool:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to list memories: ${errorMessage}`);
    }
  }

  /**
   * MCP Tool: update_memory
   * Update existing memory
   */
  async updateMemory(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('update_memory tool called');

      // Validate input using Zod schema
      const validatedInput: UpdateMemoryToolInput =
        updateMemoryToolSchema.parse(input);

      // Convert to service DTO
      const updateDto: UpdateMemoryDto = {
        content: validatedInput.content,
        metadata: validatedInput.metadata,
        tags: validatedInput.tags,
        ttl: validatedInput.ttl,
      };

      // Update memory using service
      const memory = await this.memoryService.updateMemory(
        validatedInput.userId,
        validatedInput.memoryId,
        updateDto,
      );

      return {
        content: [
          {
            type: 'text',
            text: `Updated memory ${memory.id}: ${JSON.stringify(memory, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in update_memory tool:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to update memory: ${errorMessage}`);
    }
  }

  /**
   * MCP Tool: delete_memory
   * Delete memory by ID
   */
  async deleteMemory(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('delete_memory tool called');

      // Validate input using Zod schema (reuse get_memory schema)
      const validatedInput: GetMemoryToolInput =
        getMemoryToolSchema.parse(input);

      // Delete memory using service
      const deleted = await this.memoryService.deleteMemory(
        validatedInput.userId,
        validatedInput.memoryId,
      );

      return {
        content: [
          {
            type: 'text',
            text: deleted
              ? `Successfully deleted memory ${validatedInput.memoryId}`
              : `Memory ${validatedInput.memoryId} not found`,
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in delete_memory tool:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to delete memory: ${errorMessage}`);
    }
  }

  /**
   * MCP Tool: promote_memory
   * Promote short-term memory to long-term storage
   */
  async promoteMemory(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('promote_memory tool called');

      // Validate input using Zod schema (reuse get_memory schema)
      const validatedInput: GetMemoryToolInput =
        getMemoryToolSchema.parse(input);

      // Promote memory using service
      const promotedMemory = await this.memoryService.promoteMemory(
        validatedInput.userId,
        validatedInput.memoryId,
      );

      return {
        content: [
          {
            type: 'text',
            text: `Successfully promoted memory ${promotedMemory.id} to long-term storage: ${JSON.stringify(promotedMemory, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in promote_memory tool:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to promote memory: ${errorMessage}`);
    }
  }

  /**
   * MCP Tool: recall
   * Semantic (vector) recall over a user's long-term memories
   */
  async recall(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('recall tool called');

      // Validate input using Zod schema
      const validatedInput: RecallToolInput = recallToolSchema.parse(input);

      // Run semantic recall using service
      const results = await this.memoryService.recall(
        validatedInput.userId,
        validatedInput.query,
        {
          limit: validatedInput.limit,
          scope: validatedInput.scope,
          tags: validatedInput.tags,
          createdFrom: validatedInput.createdFrom,
          createdTo: validatedInput.createdTo,
        },
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                query: validatedInput.query,
                count: results.length,
                results: results.map((result) => ({
                  score: result.score,
                  memory: result.memory,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in recall tool:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to recall memories: ${errorMessage}`);
    }
  }

  /**
   * MCP Tool: reindex_memories
   * Rebuild the vector store from Postgres (the source of truth). Idempotent
   * and cursor-resumable; intended for operators backfilling a vector backend.
   */
  async reindexMemories(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('reindex_memories tool called');

      const validatedInput: ReindexToolInput = reindexToolSchema.parse(input);
      this.assertAdminAuthorized(validatedInput.adminToken);

      const summary = await this.memoryService.reindex({
        userId: validatedInput.userId,
        batchSize: validatedInput.batchSize,
        reuseExistingEmbeddings: validatedInput.reuseExistingEmbeddings,
        cursor: validatedInput.cursor,
        maxMemories: validatedInput.maxMemories,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                scope: validatedInput.userId ?? 'all-users',
                ...summary,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in reindex_memories tool:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to reindex memories: ${errorMessage}`);
    }
  }

  /**
   * MCP Tool: queue_reindex_memories
   * Enqueue an asynchronous reindex job and return its job id.
   */
  async queueReindexMemories(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('queue_reindex_memories tool called');

      const validatedInput: ReindexQueueToolInput =
        reindexQueueToolSchema.parse(input);
      this.assertAdminAuthorized(validatedInput.adminToken);

      const job = await this.reindexQueue.enqueue({
        userId: validatedInput.userId,
        batchSize: validatedInput.batchSize,
        reuseExistingEmbeddings: validatedInput.reuseExistingEmbeddings,
        cursor: validatedInput.cursor,
        maxMemories: validatedInput.maxMemories,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                jobId: job.jobId,
                state: job.state,
                createdAt: job.createdAt,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in queue_reindex_memories tool:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to queue reindex job: ${errorMessage}`);
    }
  }

  /**
   * MCP Tool: get_reindex_status
   * Poll queued reindex progress and resumability cursor by job id.
   */
  async getReindexStatus(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('get_reindex_status tool called');

      const validatedInput: ReindexStatusToolInput =
        reindexStatusToolSchema.parse(input);
      this.assertAdminAuthorized(validatedInput.adminToken);

      const job = await this.reindexQueue.get(validatedInput.jobId);
      if (!job) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { jobId: validatedInput.jobId, state: 'not_found' },
                null,
                2,
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(job, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in get_reindex_status tool:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to get reindex status: ${errorMessage}`);
    }
  }

  /**
   * MCP Tool: cancel_reindex_job
   * Request cancellation for a queued/running reindex job.
   */
  async cancelReindexJob(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('cancel_reindex_job tool called');

      const validatedInput: ReindexCancelToolInput =
        reindexCancelToolSchema.parse(input);
      this.assertAdminAuthorized(validatedInput.adminToken);

      const job = await this.reindexQueue.cancel(validatedInput.jobId);
      if (!job) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { jobId: validatedInput.jobId, state: 'not_found' },
                null,
                2,
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(job, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in cancel_reindex_job tool:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to cancel reindex job: ${errorMessage}`);
    }
  }

  /**
   * MCP Tool: retry_reindex_job
   * Retry a failed/cancelled reindex job from its latest cursor.
   */
  async retryReindexJob(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('retry_reindex_job tool called');

      const validatedInput: ReindexRetryToolInput =
        reindexRetryToolSchema.parse(input);
      this.assertAdminAuthorized(validatedInput.adminToken);

      const job = await this.reindexQueue.retry(validatedInput.jobId);
      if (!job) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { jobId: validatedInput.jobId, state: 'not_found' },
                null,
                2,
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(job, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in retry_reindex_job tool:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to retry reindex job: ${errorMessage}`);
    }
  }

  /**
   * Get MCP tools in the format required by the MCP handler
   * This method creates Tool objects that bind controller methods as handlers
   */
  getMcpTools(): Tool[] {
    return [
      {
        name: 'create_memory',
        description: 'Create a new memory in short-term or long-term storage',
        inputSchema: createMemoryToolSchema,
        handler: this.createMemory.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'get_memory',
        description: 'Retrieve memory by ID',
        inputSchema: getMemoryToolSchema,
        handler: this.getMemory.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'list_memories',
        description: 'List memories with pagination and filtering',
        inputSchema: listMemoriesToolSchema,
        handler: this.listMemories.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'update_memory',
        description: 'Update existing memory',
        inputSchema: updateMemoryToolSchema,
        handler: this.updateMemory.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'delete_memory',
        description: 'Delete memory by ID',
        inputSchema: getMemoryToolSchema, // Reuse get_memory schema
        handler: this.deleteMemory.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'promote_memory',
        description: 'Promote short-term memory to long-term storage',
        inputSchema: getMemoryToolSchema, // Reuse get_memory schema
        handler: this.promoteMemory.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'recall',
        description:
          'Semantically recall the most relevant long-term memories for a natural-language query',
        inputSchema: recallToolSchema,
        handler: this.recall.bind(this) as (input: unknown) => Promise<unknown>,
      },
      {
        name: 'reindex_memories',
        description:
          'Rebuild the vector store from Postgres (admin/maintenance). Backfills embeddings for one user or all users; idempotent and cursor-resumable',
        inputSchema: reindexToolSchema,
        handler: this.reindexMemories.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'queue_reindex_memories',
        description:
          'Queue asynchronous vector reindexing with persisted progress and resumability cursor',
        inputSchema: reindexQueueToolSchema,
        handler: this.queueReindexMemories.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'get_reindex_status',
        description:
          'Get status and progress for a queued reindex job (queued/running/completed/failed)',
        inputSchema: reindexStatusToolSchema,
        handler: this.getReindexStatus.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'cancel_reindex_job',
        description:
          'Cancel a queued/running reindex job and preserve progress cursor',
        inputSchema: reindexCancelToolSchema,
        handler: this.cancelReindexJob.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'retry_reindex_job',
        description:
          'Retry a failed/cancelled reindex job from its last persisted cursor',
        inputSchema: reindexRetryToolSchema,
        handler: this.retryReindexJob.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
    ];
  }

  /**
   * Get MCP tool definitions for registration
   * @deprecated Use getMcpTools() instead - this method is kept for backward compatibility
   */
  getMcpToolDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return [
      {
        name: 'create_memory',
        description: 'Create a new memory in short-term or long-term storage',
        inputSchema: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User ID' },
            content: {
              type: 'string',
              maxLength: 10240,
              description: 'Memory content (max 10KB)',
            },
            type: {
              type: 'string',
              enum: ['short-term', 'long-term'],
              description: 'Memory storage type',
            },
            metadata: {
              type: 'object',
              description: 'Optional metadata object',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              maxItems: 50,
              description: 'Optional tags for categorization',
            },
            ttl: {
              type: 'number',
              minimum: 60,
              maximum: 604800,
              description:
                'TTL in seconds for short-term memories (60s to 7 days)',
            },
          },
          required: ['userId', 'content', 'type'],
        },
      },
      {
        name: 'get_memory',
        description: 'Retrieve memory by ID',
        inputSchema: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User ID' },
            memoryId: { type: 'string', description: 'Memory ID' },
          },
          required: ['userId', 'memoryId'],
        },
      },
      {
        name: 'list_memories',
        description: 'List memories with pagination and filtering',
        inputSchema: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User ID' },
            type: {
              type: 'string',
              enum: ['short-term', 'long-term'],
              description: 'Filter by memory type',
            },
            limit: {
              type: 'number',
              minimum: 1,
              maximum: 100,
              default: 20,
              description: 'Number of memories to return',
            },
            cursor: { type: 'string', description: 'Pagination cursor' },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by tags',
            },
            search: {
              type: 'string',
              maxLength: 500,
              description: 'Search in memory content',
            },
          },
          required: ['userId'],
        },
      },
      {
        name: 'update_memory',
        description: 'Update existing memory',
        inputSchema: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User ID' },
            memoryId: { type: 'string', description: 'Memory ID' },
            content: {
              type: 'string',
              maxLength: 10240,
              description: 'Updated memory content',
            },
            metadata: {
              type: 'object',
              description: 'Updated metadata object',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              maxItems: 50,
              description: 'Updated tags',
            },
            ttl: {
              type: 'number',
              minimum: 60,
              maximum: 604800,
              description: 'Updated TTL for short-term memories',
            },
          },
          required: ['userId', 'memoryId'],
        },
      },
      {
        name: 'delete_memory',
        description: 'Delete memory by ID',
        inputSchema: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User ID' },
            memoryId: { type: 'string', description: 'Memory ID' },
          },
          required: ['userId', 'memoryId'],
        },
      },
      {
        name: 'promote_memory',
        description: 'Promote short-term memory to long-term storage',
        inputSchema: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User ID' },
            memoryId: { type: 'string', description: 'Memory ID' },
          },
          required: ['userId', 'memoryId'],
        },
      },
    ];
  }
}
