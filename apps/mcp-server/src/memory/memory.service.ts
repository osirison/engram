import { Injectable, Logger } from '@nestjs/common';
import { MemoryStmService, StmMemory } from '@engram/memory-stm';
import { MemoryLtmService, LtmMemory } from '@engram/memory-ltm';

// Temporary interfaces until packages are built
interface Memory {
  id: string;
  userId: string;
  content: string;
  metadata?: Record<string, unknown>;
  tags: string[];
  type: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date | null;
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

  constructor(
    private readonly stmService: MemoryStmService,
    private readonly ltmService: MemoryLtmService,
  ) {
    this.logger.log('MemoryService initialized with STM and LTM services');
  }

  async createMemory(dto: CreateMemoryDto): Promise<Memory> {
    this.logger.debug(`Creating ${dto.type} memory for user: ${dto.userId}`);

    if (dto.type === 'short-term') {
      const stmMemory = await this.stmService.create({
        userId: dto.userId,
        content: dto.content,
        metadata: dto.metadata,
        tags: dto.tags || [],
        ttl: dto.ttl,
      });
      return this.mapStmToMemory(stmMemory);
    } else if (dto.type === 'long-term') {
      const ltmMemory = await this.ltmService.create({
        userId: dto.userId,
        content: dto.content,
        metadata: dto.metadata,
        tags: dto.tags || [],
      });
      return this.mapLtmToMemory(ltmMemory);
    }

    throw new Error(`Invalid memory type: ${String(dto.type)}`);
  }

  async getMemory(userId: string, memoryId: string): Promise<Memory | null> {
    this.logger.debug(`Getting memory ${memoryId} for user: ${userId}`);

    // Try to fetch from short-term memory first
    try {
      const stmMemory = await this.stmService.findById(userId, memoryId);
      if (stmMemory) {
        return this.mapStmToMemory(stmMemory);
      }
    } catch (error) {
      // Memory not found in STM, try LTM
      this.logger.debug(
        `Memory ${memoryId} not found in STM, trying LTM: ${error}`,
      );
    }

    // Try to fetch from long-term memory
    const ltmMemory = await this.ltmService.get(userId, memoryId);
    if (ltmMemory) {
      return this.mapLtmToMemory(ltmMemory);
    }

    return null;
  }

  async listMemories(
    userId: string,
    options: ListMemoryOptions = {},
  ): Promise<PaginatedMemories> {
    this.logger.debug(
      `Listing memories for user: ${userId} with options:`,
      options,
    );

    // For now, only query LTM since STM list() is not fully implemented
    // STM list() requires Redis SCAN pattern support
    const ltmResult = await this.ltmService.list(userId, {
      limit: options.limit || 10,
      cursor: options.cursor,
      tags: options.tags,
      search: options.search,
    });

    return {
      items: ltmResult.items.map((item) => this.mapLtmToMemory(item)),
      totalCount: ltmResult.totalCount,
      hasNextPage: ltmResult.hasNextPage,
      hasPreviousPage: ltmResult.hasPreviousPage,
      startCursor: ltmResult.startCursor,
      endCursor: ltmResult.endCursor,
    };
  }

  async updateMemory(
    userId: string,
    memoryId: string,
    updates: UpdateMemoryDto,
  ): Promise<Memory> {
    this.logger.debug(
      `Updating memory ${memoryId} for user: ${userId} with updates:`,
      updates,
    );

    // Try to update in short-term memory first
    try {
      const stmMemory = await this.stmService.update(userId, memoryId, {
        content: updates.content,
        metadata: updates.metadata,
        tags: updates.tags ?? [],
        ttl: updates.ttl,
      });
      return this.mapStmToMemory(stmMemory);
    } catch (error) {
      // Memory not found in STM, try LTM
      this.logger.debug(
        `Memory ${memoryId} not found in STM, trying LTM: ${error}`,
      );
    }

    // Try to update in long-term memory
    const ltmMemory = await this.ltmService.update(userId, memoryId, {
      content: updates.content,
      metadata: updates.metadata,
      tags: updates.tags,
    });
    return this.mapLtmToMemory(ltmMemory);
  }

  async deleteMemory(userId: string, memoryId: string): Promise<boolean> {
    this.logger.debug(`Deleting memory ${memoryId} for user: ${userId}`);

    // Try to delete from short-term memory first
    try {
      await this.stmService.delete(userId, memoryId);
      this.logger.debug(`Successfully deleted memory ${memoryId} from STM`);
      return true;
    } catch (error) {
      // Memory not found in STM, try LTM
      this.logger.debug(
        `Memory ${memoryId} not found in STM, trying LTM: ${error}`,
      );
    }

    // Try to delete from long-term memory
    const deleted = await this.ltmService.delete(userId, memoryId);
    if (deleted) {
      this.logger.debug(`Successfully deleted memory ${memoryId} from LTM`);
    }
    return deleted;
  }

  async promoteMemory(userId: string, memoryId: string): Promise<Memory> {
    this.logger.debug(
      `Promoting memory ${memoryId} from STM to LTM for user: ${userId}`,
    );

    // The LTM service has a promote method that handles the entire operation
    const ltmMemory = await this.ltmService.promote(userId, memoryId);
    this.logger.log(`Successfully promoted memory ${memoryId} from STM to LTM`);
    return this.mapLtmToMemory(ltmMemory);
  }

  // Mapper functions to convert between service types and generic Memory interface
  private mapStmToMemory(stmMemory: StmMemory): Memory {
    return {
      id: stmMemory.id,
      userId: stmMemory.userId,
      content: stmMemory.content,
      metadata: stmMemory.metadata || undefined,
      tags: stmMemory.tags || [],
      type: 'short-term',
      createdAt: stmMemory.createdAt,
      updatedAt: stmMemory.updatedAt,
      expiresAt: stmMemory.expiresAt,
    };
  }

  private mapLtmToMemory(ltmMemory: LtmMemory): Memory {
    return {
      id: ltmMemory.id,
      userId: ltmMemory.userId,
      content: ltmMemory.content,
      metadata: ltmMemory.metadata || undefined,
      tags: ltmMemory.tags || [],
      type: 'long-term',
      createdAt: ltmMemory.createdAt,
      updatedAt: ltmMemory.updatedAt,
      expiresAt: ltmMemory.expiresAt,
    };
  }
}
