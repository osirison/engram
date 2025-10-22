import { Controller, Injectable, Logger } from '@nestjs/common';
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

/**
 * MCP Memory Tools Controller
 *
 * Implements 6 MCP tools for memory management:
 * 1. create_memory - Create short-term or long-term memory
 * 2. get_memory - Retrieve memory by ID
 * 3. list_memories - List memories with pagination
 * 4. update_memory - Update existing memory
 * 5. delete_memory - Delete memory by ID
 * 6. promote_memory - Convert STM memory to LTM
 */
@Controller('memory')
@Injectable()
export class MemoryController {
  private readonly logger = new Logger(MemoryController.name);

  constructor(private readonly memoryService: MemoryService) {}

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
   * Get MCP tool definitions for registration
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
