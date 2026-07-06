import {
  Controller,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import type { Tool, ToolCallContext } from '@engram/core';
import {
  DeploymentProfile,
  resolveCapabilities,
  coerceDeploymentProfile,
} from '@engram/config';
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
import {
  reembedMemoryToolSchema,
  ReembedMemoryToolInput,
} from './dto/reembed.dto';
import {
  mutateByIdToolSchema,
  MutateByIdToolInput,
} from './dto/mutate-by-id.dto';
import {
  bulkDeleteToolSchema,
  BulkDeleteToolInput,
} from './dto/bulk-delete.dto';
import {
  restoreMemoryToolSchema,
  RestoreMemoryToolInput,
  getMemoryAuditToolSchema,
  GetMemoryAuditToolInput,
} from './dto/audit.dto';
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
import {
  consolidateToolSchema,
  ConsolidateToolInput,
} from './dto/consolidate.dto';
import { rememberToolSchema, RememberToolInput } from './dto/remember.dto';
import { forgetToolSchema, ForgetToolInput } from './dto/forget.dto';
import { reflectToolSchema, ReflectToolInput } from './dto/reflect.dto';
import {
  compressContextToolSchema,
  CompressContextToolInput,
  loadContextToolSchema,
  LoadContextToolInput,
  promptContextToolSchema,
  PromptContextToolInput,
} from './dto/context.dto';
import {
  ingestConversationToolSchema,
  IngestConversationToolInput,
} from './dto/ingest-conversation.dto';
import { exportToolSchema, ExportToolInput } from './dto/export.dto';
import { ReindexQueueService } from './reindex-queue.service';
import { ConsolidationService } from './consolidation.service';
import {
  MemoryAuditService,
  type MemorySnapshot,
} from './memory-audit.service';
import { MemoryExportService } from './export/memory-export.service';
import { CollectingSink } from './export/collecting-sink';
import { DirectorySink } from './export/directory-sink';
import type { MemoryExportOptions } from './export/export.types';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constantTimeStringEqual } from '../security/admin-token.util';
import {
  ClientFacingError,
  toClientError,
} from '../security/client-error.util';

/**
 * MCP Memory Tools Controller
 *
 * Implements 24 MCP tools for memory management:
 * 1.  create_memory          - Create short-term or long-term memory
 * 2.  get_memory             - Retrieve memory by ID
 * 3.  list_memories          - List memories with pagination
 * 4.  update_memory          - Update existing memory
 * 5.  delete_memory          - Delete memory by ID
 * 5a. bulk_delete_memories   - Delete up to 100 memories with a per-item report (WP2 T6)
 * 6.  promote_memory         - Convert STM memory to LTM
 * 6a. reembed_memory         - Regenerate a long-term memory's vector (repair drift)
 * 6b. restore_memory         - Recreate a deleted memory from its audit snapshot
 * 6c. get_memory_audit       - Read a memory's audit history (WP2 T5)
 * 7.  recall                 - Semantic (vector) recall over long-term memories
 * 8.  reindex_memories       - Backfill/rebuild the vector store from Postgres
 * 9.  queue_reindex_memories - Queue resumable reindex processing as a job
 * 10. get_reindex_status     - Poll queued reindex progress by job id
 * 11. cancel_reindex_job     - Request cancellation for a queued/running job
 * 12. retry_reindex_job      - Retry a failed/cancelled job from its last cursor
 * 13. consolidate_memories   - Trigger STM→LTM consolidation pass (admin)
 * 14. remember               - Smart create: auto-detects type, deduplicates
 * 15. forget                 - Smart delete: find + optionally delete by concept
 * 16. reflect                - Synthesise structured insights across memories
 * 17. compress_context       - Retrieve + format memories as an injectable context block
 * 18. load_context           - Load recent + important memories for session priming
 * 19. ingest_conversation    - Bulk-ingest a conversation as chunked per-turn memories
 * 20. prompt_context         - Token-budgeted context assembly ranked by query relevance
 */
@Controller('memory')
@Injectable()
export class MemoryController {
  private readonly logger = new Logger(MemoryController.name);
  private readonly activeProfile: DeploymentProfile;

  constructor(
    private readonly memoryService: MemoryService,
    @Optional()
    @Inject(ReindexQueueService)
    private readonly reindexQueue: ReindexQueueService | null,
    private readonly consolidation: ConsolidationService,
    // Audit trail (WP2 T5): Postgres-only, so optional — absent under the
    // memory/lite profiles, where destructive ops simply are not audited.
    @Optional()
    @Inject(MemoryAuditService)
    private readonly audit: MemoryAuditService | null = null,
    // Markdown export (WP3 T7): Postgres-only, so optional — absent under the
    // memory/lite profiles, where the tool is simply not registered.
    @Optional()
    @Inject(MemoryExportService)
    private readonly memoryExport: MemoryExportService | null = null,
  ) {
    this.activeProfile = coerceDeploymentProfile(
      process.env['DEPLOYMENT_PROFILE'],
      DeploymentProfile.ENTERPRISE,
    );
  }

  /**
   * Capture the auditable pre-image of a memory (WP2 T5/D6). Returns null when
   * the memory can't be read (already gone), so callers still record the attempt.
   */
  private async snapshotOf(
    userId: string,
    memoryId: string,
    scope?: string,
  ): Promise<{
    snapshot: MemorySnapshot;
    organizationId: string | null;
  } | null> {
    let memory: Awaited<ReturnType<MemoryService['getMemory']>> | null = null;
    try {
      memory = await this.memoryService.getMemory(userId, memoryId, scope);
    } catch {
      memory = null;
    }
    if (!memory) {
      return null;
    }
    return {
      snapshot: {
        content: memory.content,
        tags: memory.tags,
        metadata: memory.metadata,
        type: memory.type,
        scope: memory.scope ?? null,
        expiresAt: memory.expiresAt
          ? new Date(memory.expiresAt).toISOString()
          : null,
        version: (memory as { version?: number }).version,
      },
      organizationId: memory.organizationId ?? null,
    };
  }

  private assertAdminAuthorized(
    adminToken: string,
    operation: string,
    target?: string,
  ): void {
    const expected = process.env.MCP_ADMIN_TOKEN;
    if (!expected) {
      // Audit log: refuse with reason so operators can diagnose.
      this.logger.warn(
        `admin_auth_denied operation=${operation} reason=missing_mcp_admin_token target=${target ?? 'n/a'}`,
      );
      throw new ClientFacingError('MCP_ADMIN_TOKEN is not configured');
    }
    if (!constantTimeStringEqual(adminToken, expected)) {
      this.logger.warn(
        `admin_auth_denied operation=${operation} reason=invalid_token target=${target ?? 'n/a'}`,
      );
      throw new ClientFacingError('Unauthorized maintenance operation');
    }
    this.logger.log(
      `admin_auth_ok operation=${operation} target=${target ?? 'n/a'}`,
    );
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
        scope: validatedInput.scope,
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
      throw toClientError(error, 'Failed to create memory');
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
        validatedInput.scope,
      );

      if (!memory) {
        // Machine-readable first item so programmatic callers (the web console —
        // mcp-client.ts parses the first text item as JSON) stop string-matching
        // prose; the human sentence stays as a second item (WP2 T2/D2).
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                found: false,
                memoryId: validatedInput.memoryId,
              }),
            },
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
      throw toClientError(error, 'Failed to get memory');
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
          scope: validatedInput.scope,
          tags: validatedInput.tags,
          search: validatedInput.search,
          // Honour the tier filter (previously dropped — WP2 T2/A29): a typed
          // call queries exactly one tier, which is what stable pagination needs.
          type: validatedInput.type,
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
      throw toClientError(error, 'Failed to list memories');
    }
  }

  /**
   * MCP Tool: update_memory
   * Update existing memory
   */
  async updateMemory(
    input: unknown,
    context?: ToolCallContext,
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
        expectedVersion: validatedInput.expectedVersion,
      };

      // Snapshot the pre-image for the audit trail (WP2 T5) before mutating.
      const pre = await this.snapshotOf(
        validatedInput.userId,
        validatedInput.memoryId,
        validatedInput.scope,
      );

      // Update memory using service
      const memory = await this.memoryService.updateMemory(
        validatedInput.userId,
        validatedInput.memoryId,
        updateDto,
        validatedInput.scope,
      );

      await this.audit?.record({
        memoryId: memory.id,
        userId: validatedInput.userId,
        organizationId: pre?.organizationId,
        scope: validatedInput.scope ?? memory.scope ?? null,
        action: 'update',
        context,
        actorLabel: validatedInput.actorLabel,
        before: pre?.snapshot ?? null,
        after: {
          content: memory.content,
          tags: memory.tags,
          metadata: memory.metadata,
          version: (memory as { version?: number }).version,
        },
      });

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
      // Optimistic-concurrency conflict (WP2 T4/D5): surface it as a client-facing
      // `CONFLICT:` message (checked by name to avoid coupling to the store
      // packages) so the web maps it to tRPC CONFLICT / HTTP 409.
      if (
        error instanceof Error &&
        (error.name === 'LtmVersionConflictError' ||
          error.name === 'StmVersionConflictError')
      ) {
        throw toClientError(
          new ClientFacingError(`CONFLICT: ${error.message}`),
          'Failed to update memory',
        );
      }
      throw toClientError(error, 'Failed to update memory');
    }
  }

  /**
   * MCP Tool: delete_memory
   * Delete memory by ID
   */
  async deleteMemory(
    input: unknown,
    context?: ToolCallContext,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('delete_memory tool called');

      // Validate input (get_memory locator + optional actorLabel — WP2 T5).
      const validatedInput: MutateByIdToolInput =
        mutateByIdToolSchema.parse(input);

      // Snapshot BEFORE deleting — this pre-image is the source for restore_memory
      // (WP2 T5/G5). Fetch first, then delete, then audit the attempt.
      const pre = await this.snapshotOf(
        validatedInput.userId,
        validatedInput.memoryId,
        validatedInput.scope,
      );

      // Delete memory using service
      const deleted = await this.memoryService.deleteMemory(
        validatedInput.userId,
        validatedInput.memoryId,
        validatedInput.scope,
      );

      // Record the attempt even when nothing was deleted (audit over-reports
      // attempts but never under-reports successes — WP2 T5 accepted trade-off).
      await this.audit?.record({
        memoryId: validatedInput.memoryId,
        userId: validatedInput.userId,
        organizationId: pre?.organizationId,
        scope: validatedInput.scope ?? pre?.snapshot.scope ?? null,
        action: 'delete',
        context,
        actorLabel: validatedInput.actorLabel,
        before: pre?.snapshot ?? null,
        after: { deleted },
      });

      // Machine-readable first item so callers get the real outcome (the web
      // backend previously reported {deleted:true} unconditionally — A10); the
      // human sentence stays as a second item (WP2 T2/D2).
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              deleted,
              memoryId: validatedInput.memoryId,
            }),
          },
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
      throw toClientError(error, 'Failed to delete memory');
    }
  }

  /**
   * MCP Tool: bulk_delete_memories
   * Delete up to 100 memories in one call with a per-item report (WP2 T6/D9).
   */
  async bulkDeleteMemories(
    input: unknown,
    context?: ToolCallContext,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('bulk_delete_memories tool called');

      const validatedInput: BulkDeleteToolInput =
        bulkDeleteToolSchema.parse(input);

      // Snapshot every target BEFORE deleting so each row remains restorable
      // (WP2 T5/T6). Snapshotting is best-effort; a missing pre-image just means
      // that id can't be restored later. De-duplicate ids and read in bounded
      // parallel batches so up to 100 targets don't serialise into N round-trips
      // before the first delete (PR #222 review).
      const snapshots = new Map<
        string,
        Awaited<ReturnType<MemoryController['snapshotOf']>>
      >();
      const uniqueIds = [...new Set(validatedInput.memoryIds)];
      const SNAPSHOT_BATCH = 10;
      for (let i = 0; i < uniqueIds.length; i += SNAPSHOT_BATCH) {
        const batch = uniqueIds.slice(i, i + SNAPSHOT_BATCH);
        const pre = await Promise.all(
          batch.map((id) =>
            this.snapshotOf(validatedInput.userId, id, validatedInput.scope),
          ),
        );
        batch.forEach((id, j) => snapshots.set(id, pre[j] ?? null));
      }

      const result = await this.memoryService.bulkDeleteMemories(
        validatedInput.userId,
        validatedInput.memoryIds,
        validatedInput.scope,
      );

      // Audit each successfully deleted id with its pre-image (WP2 T5).
      for (const id of result.deleted) {
        const pre = snapshots.get(id) ?? null;
        await this.audit?.record({
          memoryId: id,
          userId: validatedInput.userId,
          organizationId: pre?.organizationId,
          scope: validatedInput.scope ?? pre?.snapshot.scope ?? null,
          action: 'bulk-delete',
          context,
          actorLabel: validatedInput.actorLabel,
          before: pre?.snapshot ?? null,
          after: { deleted: true },
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              deleted: result.deleted,
              failed: result.failed,
              deletedCount: result.deleted.length,
              failedCount: result.failed.length,
            }),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in bulk_delete_memories tool:', error);
      throw toClientError(error, 'Failed to bulk-delete memories');
    }
  }

  /**
   * MCP Tool: promote_memory
   * Promote short-term memory to long-term storage
   */
  async promoteMemory(
    input: unknown,
    context?: ToolCallContext,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('promote_memory tool called');

      // Validate input (get_memory locator + optional actorLabel — WP2 T5).
      const validatedInput: MutateByIdToolInput =
        mutateByIdToolSchema.parse(input);

      // Promote memory using service
      const promotedMemory = await this.memoryService.promoteMemory(
        validatedInput.userId,
        validatedInput.memoryId,
        validatedInput.scope,
      );

      await this.audit?.record({
        memoryId: promotedMemory.id,
        userId: validatedInput.userId,
        organizationId: promotedMemory.organizationId ?? null,
        scope: validatedInput.scope ?? promotedMemory.scope ?? null,
        action: 'promote',
        context,
        actorLabel: validatedInput.actorLabel,
        before: { type: 'short-term' },
        after: { type: 'long-term', memoryId: promotedMemory.id },
      });

      // Structured first item (WP2 T3/D2): promotion mints a NEW long-term id and
      // deletes the STM row, so the caller can't re-read by the old id — it must
      // learn the promoted memory from the result. Human prose stays second.
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ promoted: true, memory: promotedMemory }),
          },
          {
            type: 'text',
            text: `Successfully promoted memory ${promotedMemory.id} to long-term storage`,
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in promote_memory tool:', error);
      throw toClientError(error, 'Failed to promote memory');
    }
  }

  /**
   * MCP Tool: reembed_memory
   * Regenerate the vector for a long-term memory's current content and clear its
   * `embeddingStale` flag (WP2 T7). Repairs drift left by a content edit that
   * happened while the embeddings provider was unavailable.
   */
  async reembedMemory(
    input: unknown,
    context?: ToolCallContext,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('reembed_memory tool called');

      const validatedInput: ReembedMemoryToolInput =
        reembedMemoryToolSchema.parse(input);

      const memory = await this.memoryService.reembedMemory(
        validatedInput.userId,
        validatedInput.memoryId,
        validatedInput.scope,
      );

      await this.audit?.record({
        memoryId: memory.id,
        userId: validatedInput.userId,
        organizationId: memory.organizationId ?? null,
        scope: validatedInput.scope ?? memory.scope ?? null,
        action: 'reembed',
        context,
        actorLabel: validatedInput.actorLabel,
        after: { reembedded: true },
      });

      return {
        content: [
          {
            type: 'text',
            text: `Re-embedded memory ${memory.id}: ${JSON.stringify(memory, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in reembed_memory tool:', error);
      // Provider unavailable / STM guard carry client-safe messages; forward them
      // (checked by name to avoid coupling to the store + Nest exception types).
      if (
        error instanceof Error &&
        error.name === 'LtmEmbeddingUnavailableError'
      ) {
        throw toClientError(
          new ClientFacingError(
            'the embeddings provider is unavailable; retry once it is back',
          ),
          'Failed to re-embed memory',
        );
      }
      if (error instanceof Error && error.name === 'BadRequestException') {
        throw toClientError(
          new ClientFacingError(error.message),
          'Failed to re-embed memory',
        );
      }
      throw toClientError(error, 'Failed to re-embed memory');
    }
  }

  /**
   * MCP Tool: restore_memory
   * Recreate a hard-deleted memory from the newest `delete` audit snapshot,
   * preserving its original id (WP2 T5/G5). Requires the audit trail.
   */
  async restoreMemory(
    input: unknown,
    context?: ToolCallContext,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('restore_memory tool called');

      const validatedInput: RestoreMemoryToolInput =
        restoreMemoryToolSchema.parse(input);

      if (!this.audit) {
        throw new ClientFacingError(
          'restore is unavailable: the audit trail is not enabled on this server',
        );
      }

      const recoverable = await this.audit.findLatestDeleteSnapshot(
        validatedInput.userId,
        validatedInput.memoryId,
      );
      if (!recoverable || !recoverable.before.content) {
        throw new ClientFacingError(
          `No recoverable delete snapshot found for memory ${validatedInput.memoryId}`,
        );
      }

      const restored = await this.memoryService.restoreMemory({
        id: validatedInput.memoryId,
        userId: validatedInput.userId,
        content: recoverable.before.content,
        tags: recoverable.before.tags,
        metadata: (recoverable.before.metadata ?? null) as Record<
          string,
          unknown
        > | null,
        scope: recoverable.before.scope ?? recoverable.scope,
        organizationId: recoverable.organizationId,
        type: recoverable.before.type,
      });

      await this.audit.record({
        memoryId: restored.id,
        userId: validatedInput.userId,
        organizationId: restored.organizationId ?? null,
        scope: restored.scope ?? null,
        action: 'restore',
        context,
        actorLabel: validatedInput.actorLabel,
        before: recoverable.before,
        after: { restored: true, memoryId: restored.id },
      });

      return {
        content: [
          {
            type: 'text',
            text: `Restored memory ${restored.id}: ${JSON.stringify(restored, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in restore_memory tool:', error);
      throw toClientError(error, 'Failed to restore memory');
    }
  }

  /**
   * MCP Tool: get_memory_audit
   * Read the audit history for a memory, newest first (WP2 T5).
   */
  async getMemoryAudit(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('get_memory_audit tool called');

      const validatedInput: GetMemoryAuditToolInput =
        getMemoryAuditToolSchema.parse(input);

      const entries = this.audit
        ? await this.audit.list(
            validatedInput.userId,
            validatedInput.memoryId,
            validatedInput.limit,
          )
        : [];

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ entries }, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in get_memory_audit tool:', error);
      throw toClientError(error, 'Failed to read memory audit');
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
      throw toClientError(error, 'Failed to recall memories');
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
      this.assertAdminAuthorized(
        validatedInput.adminToken,
        'reindex_memories',
        validatedInput.userId ?? 'all-users',
      );

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
      throw toClientError(error, 'Failed to reindex memories');
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

      if (!this.reindexQueue) {
        throw new ClientFacingError(
          'Reindex queue is not available in this deployment profile',
        );
      }
      const validatedInput: ReindexQueueToolInput =
        reindexQueueToolSchema.parse(input);
      this.assertAdminAuthorized(
        validatedInput.adminToken,
        'queue_reindex_memories',
        validatedInput.userId ?? 'all-users',
      );

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
      throw toClientError(error, 'Failed to queue reindex job');
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
      if (!this.reindexQueue) {
        throw new ClientFacingError(
          'Reindex queue is not available in this deployment profile',
        );
      }

      const validatedInput: ReindexStatusToolInput =
        reindexStatusToolSchema.parse(input);
      this.assertAdminAuthorized(
        validatedInput.adminToken,
        'get_reindex_status',
        validatedInput.jobId,
      );

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
      throw toClientError(error, 'Failed to get reindex status');
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
      if (!this.reindexQueue) {
        throw new ClientFacingError(
          'Reindex queue is not available in this deployment profile',
        );
      }

      const validatedInput: ReindexCancelToolInput =
        reindexCancelToolSchema.parse(input);
      this.assertAdminAuthorized(
        validatedInput.adminToken,
        'cancel_reindex_job',
        validatedInput.jobId,
      );

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
      throw toClientError(error, 'Failed to cancel reindex job');
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
      if (!this.reindexQueue) {
        throw new ClientFacingError(
          'Reindex queue is not available in this deployment profile',
        );
      }

      const validatedInput: ReindexRetryToolInput =
        reindexRetryToolSchema.parse(input);
      this.assertAdminAuthorized(
        validatedInput.adminToken,
        'retry_reindex_job',
        validatedInput.jobId,
      );

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
      throw toClientError(error, 'Failed to retry reindex job');
    }
  }

  /**
   * MCP Tool: consolidate_memories (admin)
   * Trigger a synchronous STM→LTM consolidation pass.
   */
  async consolidateMemories(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('consolidate_memories tool called');
      const validatedInput: ConsolidateToolInput =
        consolidateToolSchema.parse(input);
      this.assertAdminAuthorized(
        validatedInput.adminToken,
        'consolidate_memories',
        validatedInput.userId ?? 'all-users',
      );

      const result = await this.consolidation.run(validatedInput.userId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                promoted: result.promoted,
                skipped: result.skipped,
                failed: result.failed,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in consolidate_memories tool:', error);
      throw toClientError(error, 'Failed to run consolidation');
    }
  }

  // ─── C1: High-Level Agent UX Tools ──────────────────────────────────────────

  /**
   * MCP Tool: remember
   * Smart create: auto-detects STM vs LTM, deduplicates.
   */
  async remember(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('remember tool called');
      const validated: RememberToolInput = rememberToolSchema.parse(input);

      const result = await this.memoryService.remember({
        userId: validated.userId,
        content: validated.content,
        type: validated.type,
        scope: validated.scope,
        metadata: validated.metadata,
        tags: validated.tags,
        ttl: validated.ttl,
        skipDuplicateCheck: validated.skipDuplicateCheck,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                memoryId: result.memory.id,
                resolvedType: result.resolvedType,
                wasDeduped: result.wasDeduped,
                memory: result.memory,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in remember tool:', error);
      throw toClientError(error, 'Failed to remember');
    }
  }

  /**
   * MCP Tool: forget
   * Smart delete: find memories by concept, optionally delete them.
   */
  async forget(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('forget tool called');
      const validated: ForgetToolInput = forgetToolSchema.parse(input);

      const result = await this.memoryService.forget({
        userId: validated.userId,
        query: validated.query,
        limit: validated.limit,
        confirm: validated.confirm,
        minScore: validated.minScore,
        scope: validated.scope,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                dryRun: result.dryRun,
                candidates: result.candidates,
                deleted: result.deleted,
                message: result.dryRun
                  ? `Found ${result.candidates.length} candidate(s). Pass confirm=true to delete.`
                  : `Deleted ${result.deleted} of ${result.candidates.length} matched memor${result.candidates.length === 1 ? 'y' : 'ies'}.`,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in forget tool:', error);
      throw toClientError(error, 'Failed to forget');
    }
  }

  /**
   * MCP Tool: reflect
   * Synthesise structured insights across semantically relevant memories.
   */
  async reflect(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('reflect tool called');
      const validated: ReflectToolInput = reflectToolSchema.parse(input);

      const result = await this.memoryService.reflect({
        userId: validated.userId,
        query: validated.query,
        limit: validated.limit,
        minScore: validated.minScore,
        scope: validated.scope,
        tags: validated.tags,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in reflect tool:', error);
      throw toClientError(error, 'Failed to reflect');
    }
  }

  /**
   * MCP Tool: compress_context
   * Retrieve + format memories into a compact, context-window-ready block.
   */
  async compressContext(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('compress_context tool called');
      const validated: CompressContextToolInput =
        compressContextToolSchema.parse(input);

      const result = await this.memoryService.compressContext({
        userId: validated.userId,
        query: validated.query,
        limit: validated.limit,
        maxChars: validated.maxChars,
        minScore: validated.minScore,
        scope: validated.scope,
      });

      return {
        content: [
          {
            type: 'text',
            text: result.context,
          },
          {
            type: 'text',
            text: JSON.stringify(
              {
                memoryCount: result.memoryCount,
                charCount: result.charCount,
                truncated: result.truncated,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in compress_context tool:', error);
      throw toClientError(error, 'Failed to compress context');
    }
  }

  /**
   * MCP Tool: load_context
   * Load recent + high-importance memories for session priming.
   */
  async loadContext(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('load_context tool called');
      const validated: LoadContextToolInput =
        loadContextToolSchema.parse(input);

      const result = await this.memoryService.loadContext({
        userId: validated.userId,
        maxChars: validated.maxChars,
        recentLimit: validated.recentLimit,
        importantLimit: validated.importantLimit,
        scope: validated.scope,
        tags: validated.tags,
      });

      return {
        content: [
          {
            type: 'text',
            text: result.context,
          },
          {
            type: 'text',
            text: JSON.stringify(
              {
                memoryCount: result.memoryCount,
                charCount: result.charCount,
                truncated: result.truncated,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in load_context tool:', error);
      throw toClientError(error, 'Failed to load context');
    }
  }

  /**
   * MCP Tool: ingest_conversation
   * Bulk-ingest a conversation as chunked per-turn long-term memories.
   * Idempotent: re-submitting the same conversation returns the same memory IDs.
   */
  async ingestConversation(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('ingest_conversation tool called');
      const validated: IngestConversationToolInput =
        ingestConversationToolSchema.parse(input);

      const result = await this.memoryService.ingestConversation({
        userId: validated.userId,
        turns: validated.turns,
        concurrency: validated.concurrency,
        tags: validated.tags,
        metadata: validated.metadata,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ingested: result.ingested,
                skipped: result.skipped,
                failed: result.failed,
                total: result.total,
                memoryIds: result.memoryIds,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in ingest_conversation tool:', error);
      throw toClientError(error, 'Failed to ingest conversation');
    }
  }

  /**
   * MCP Tool: prompt_context
   * Assemble a token-budgeted, query-ranked context block for prompt injection.
   */
  async promptContext(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.logger.debug('prompt_context tool called');
      const validated: PromptContextToolInput =
        promptContextToolSchema.parse(input);

      const result = await this.memoryService.assemblePromptContext({
        userId: validated.userId,
        query: validated.query,
        tokenBudget: validated.tokenBudget,
        limit: validated.limit,
        minScore: validated.minScore,
        scope: validated.scope,
        tags: validated.tags,
        createdFrom: validated.createdFrom,
        createdTo: validated.createdTo,
      });

      return {
        content: [
          {
            type: 'text',
            text: result.context,
          },
          {
            type: 'text',
            text: JSON.stringify(
              {
                memoryCount: result.memoryCount,
                estimatedTokens: result.estimatedTokens,
                tokenBudget: result.tokenBudget,
                truncated: result.truncated,
                candidatesFound: result.candidatesFound,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in prompt_context tool:', error);
      throw toClientError(error, 'Failed to assemble prompt context');
    }
  }

  /**
   * `export_memories` (WP3 T7): export a user's memories as an Obsidian vault
   * (frontmatter + `[[wikilinks]]`). Bounded exports (≤ `maxInline` memory
   * files) return the documents + manifest inline as JSON; larger exports are
   * written to a server directory and return a path reference + manifest
   * summary — never a base64 zip, which would flood the MCP text channel
   * (PLAN §4.11). Identity-mode + `delegable`: an admin key exports another
   * tenant by passing an explicit `userId`.
   */
  async exportMemories(
    input: unknown,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const validated: ExportToolInput = exportToolSchema.parse(input);
    if (!this.memoryExport) {
      throw new ClientFacingError(
        'export_memories is unavailable under this deployment profile (requires Postgres)',
      );
    }

    const options: MemoryExportOptions = {
      userId: validated.userId,
      includeStm: validated.includeStm,
      ...(validated.tags ? { tags: validated.tags } : {}),
      ...(validated.scope ? { scope: validated.scope } : {}),
      ...(validated.type ? { type: validated.type } : {}),
      ...(validated.mode ? { mode: validated.mode } : {}),
      ...(validated.dateFrom ? { dateFrom: new Date(validated.dateFrom) } : {}),
      ...(validated.dateTo ? { dateTo: new Date(validated.dateTo) } : {}),
    };

    const sink = new CollectingSink();
    const result = await this.memoryExport.export(options, sink);

    if (result.fileCount <= validated.maxInline) {
      return this.jsonContent({
        mode: 'inline',
        manifest: result.manifest,
        files: sink.toObject(),
      });
    }

    // Oversize: flush the collected files to a server directory and return a
    // reference. The path is server-local (operator-accessible), not sent as
    // content.
    const dir = await mkdtemp(join(tmpdir(), 'engram-export-'));
    const dirSink = new DirectorySink(dir);
    for (const [relativePath, content] of sink.files) {
      await dirSink.writeFile(relativePath, content);
    }
    return this.jsonContent({
      mode: 'path',
      path: dir,
      manifest: result.manifest,
      note: `Export exceeded maxInline (${validated.maxInline}); ${result.fileCount} memory files written to the server path above.`,
    });
  }

  /** Wrap a JSON-serializable value as an MCP text-content response. */
  private jsonContent(value: unknown): {
    content: Array<{ type: string; text: string }>;
  } {
    return {
      content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    };
  }

  /**
   * Get MCP tools in the format required by the MCP handler.
   *
   * This method creates Tool objects that bind controller methods as
   * handlers. The list is filtered by the active deployment profile so
   * that profile-memory does not advertise tools that depend on
   * external services, and profile-lite keeps the synchronous reindex
   * while hiding the resumable-queue / cancellation tools that rely
   * on a BullMQ worker.
   */
  getMcpTools(): Tool[] {
    const all: Tool[] = [
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
        // Delegable: an admin-scoped key (the operator console) may read any data
        // owner's memory — incl. its live STM tier — by passing an explicit
        // userId (#200). Without this, console STM reads silently target the
        // key's own tenant (WP2 T2/A28).
        delegable: true,
        handler: this.getMemory.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'list_memories',
        description: 'List memories with pagination and filtering',
        inputSchema: listMemoriesToolSchema,
        // Delegable: an admin-scoped key may enumerate any data owner's memories,
        // incl. the short-term tier via type:'short-term' (#200, WP2 T2/A28).
        delegable: true,
        handler: this.listMemories.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'update_memory',
        description: 'Update existing memory',
        inputSchema: updateMemoryToolSchema,
        // Delegable: an admin-scoped key (the operator console) may edit any
        // data owner's memory by passing an explicit userId (#200).
        delegable: true,
        handler: this.updateMemory.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'delete_memory',
        description: 'Delete memory by ID',
        // get_memory locator + optional actorLabel (WP2 T5 audit).
        inputSchema: mutateByIdToolSchema,
        // Delegable: an admin-scoped key (the operator console) may delete any
        // data owner's memory by passing an explicit userId (#200).
        delegable: true,
        handler: this.deleteMemory.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'bulk_delete_memories',
        description:
          'Delete up to 100 memories in a single call, returning a per-item report of deleted ids and failures. STM/LTM routing and scope isolation are inherited per id.',
        inputSchema: bulkDeleteToolSchema,
        // Delegable: an admin-scoped key may bulk-delete any data owner's memories.
        delegable: true,
        handler: this.bulkDeleteMemories.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'promote_memory',
        description: 'Promote short-term memory to long-term storage',
        // get_memory locator + optional actorLabel (WP2 T5 audit).
        inputSchema: mutateByIdToolSchema,
        // Delegable: an admin-scoped key (the operator console) may promote any
        // data owner's short-term memory by passing an explicit userId
        // (#200, WP2 T2/A28).
        delegable: true,
        handler: this.promoteMemory.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'reembed_memory',
        description:
          "Regenerate the vector for a long-term memory's current content and clear its embeddingStale flag. Repairs recall drift left by a content edit made while the embeddings provider was unavailable.",
        inputSchema: reembedMemoryToolSchema,
        // Delegable: the operator console repairs any data owner's memory (#200).
        delegable: true,
        handler: this.reembedMemory.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'restore_memory',
        description:
          'Recreate a hard-deleted memory from its most recent delete audit snapshot, preserving its original id. Requires the audit trail.',
        inputSchema: restoreMemoryToolSchema,
        // Delegable: the operator console restores any data owner's memory (#200).
        delegable: true,
        handler: this.restoreMemory.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'get_memory_audit',
        description:
          'Read the append-only audit history (update/delete/promote/reembed/restore) for a memory, newest first.',
        inputSchema: getMemoryAuditToolSchema,
        // Delegable: the operator console reads any data owner's history (#200).
        delegable: true,
        handler: this.getMemoryAudit.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'recall',
        description:
          'Semantically recall the most relevant long-term memories for a natural-language query',
        inputSchema: recallToolSchema,
        // Delegable: an admin-scoped key (the operator console) may run semantic
        // search on behalf of any data owner by passing an explicit userId (#200).
        delegable: true,
        handler: this.recall.bind(this) as (input: unknown) => Promise<unknown>,
      },
      {
        name: 'export_memories',
        description:
          "Export a user's memories as an Obsidian-compatible markdown vault (YAML frontmatter + [[wikilinks]] preserving inter-memory relationships). Bounded exports return documents + manifest inline; larger exports return a server path reference.",
        inputSchema: exportToolSchema,
        // Delegable: an admin-scoped key (the operator console) may export any
        // data owner's memories by passing an explicit userId (mirrors recall).
        delegable: true,
        handler: this.exportMemories.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'reindex_memories',
        description:
          'Rebuild the vector store from Postgres (admin/maintenance). Backfills embeddings for one user or all users; idempotent and cursor-resumable',
        inputSchema: reindexToolSchema,
        auth: 'admin',
        handler: this.reindexMemories.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'queue_reindex_memories',
        description:
          'Queue asynchronous vector reindexing with persisted progress and resumability cursor',
        inputSchema: reindexQueueToolSchema,
        auth: 'admin',
        handler: this.queueReindexMemories.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'get_reindex_status',
        description:
          'Get status and progress for a queued reindex job (queued/running/completed/failed)',
        inputSchema: reindexStatusToolSchema,
        auth: 'admin',
        handler: this.getReindexStatus.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'cancel_reindex_job',
        description:
          'Cancel a queued/running reindex job and preserve progress cursor',
        inputSchema: reindexCancelToolSchema,
        auth: 'admin',
        handler: this.cancelReindexJob.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'retry_reindex_job',
        description:
          'Retry a failed/cancelled reindex job from its last persisted cursor',
        inputSchema: reindexRetryToolSchema,
        auth: 'admin',
        handler: this.retryReindexJob.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'consolidate_memories',
        description:
          'Trigger a synchronous STM→LTM consolidation pass (admin). Promotes short-term memories that meet the access-count threshold into long-term storage.',
        inputSchema: consolidateToolSchema,
        auth: 'admin',
        handler: this.consolidateMemories.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      // ── C1: High-Level Agent UX Tools ────────────────────────────────────────
      {
        name: 'remember',
        description:
          'Smart create: auto-detects short-term vs long-term storage from content heuristics, deduplicates against existing memories, and returns the stored memory with routing metadata.',
        inputSchema: rememberToolSchema,
        handler: this.remember.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'forget',
        description:
          'Smart delete: find memories by natural-language concept and optionally delete them. Dry-run by default — pass confirm=true to execute deletion.',
        inputSchema: forgetToolSchema,
        handler: this.forget.bind(this) as (input: unknown) => Promise<unknown>,
      },
      {
        name: 'reflect',
        description:
          'Synthesise structured insights across all memories semantically relevant to a query. Returns a plain-text summary, extracted themes, source memory IDs, and date range.',
        inputSchema: reflectToolSchema,
        handler: this.reflect.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'compress_context',
        description:
          'Retrieve memories most relevant to a query and format them into a compact, context-window-ready block within a character budget.',
        inputSchema: compressContextToolSchema,
        handler: this.compressContext.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'load_context',
        description:
          'Load a session-priming context block by blending the most recent memories with the highest-importance memories. Ideal for injecting into a session-opening prompt.',
        inputSchema: loadContextToolSchema,
        handler: this.loadContext.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      // ── C2: Bulk / Streaming Ingestion ───────────────────────────────────────
      {
        name: 'ingest_conversation',
        description:
          'Bulk-ingest a conversation as per-turn long-term memories. Handles chunking for large turns, controls embedding back-pressure via concurrency, and is idempotent: re-submitting the same conversation returns the existing memory IDs.',
        inputSchema: ingestConversationToolSchema,
        handler: this.ingestConversation.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      // ── C3: Token-Budgeted Prompt Assembly ───────────────────────────────────
      {
        name: 'prompt_context',
        description:
          'Assemble a token-budgeted context block from memories most relevant to a query. Greedy-packs ranked memories within the token budget (1 token ≈ 4 chars). Returns the formatted block plus token accounting metadata.',
        inputSchema: promptContextToolSchema,
        handler: this.promptContext.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
    ];

    // Make API-key/JWT scopes load-bearing: each memory tool requires the
    // matching scope (the `admin` scope satisfies any). Read tools need
    // `memories:read`, mutations `memories:write`, deletions `memories:delete`.
    // Admin maintenance tools (reindex/consolidate) gate on MCP_ADMIN_TOKEN and
    // intentionally carry no scope here. Enforced in the core dispatch only when
    // a request is authenticated.
    const scopeByTool: Record<string, string> = {
      create_memory: 'memories:write',
      update_memory: 'memories:write',
      promote_memory: 'memories:write',
      reembed_memory: 'memories:write',
      restore_memory: 'memories:write',
      get_memory_audit: 'memories:read',
      remember: 'memories:write',
      ingest_conversation: 'memories:write',
      delete_memory: 'memories:delete',
      bulk_delete_memories: 'memories:delete',
      forget: 'memories:delete',
      get_memory: 'memories:read',
      list_memories: 'memories:read',
      recall: 'memories:read',
      export_memories: 'memories:read',
      reflect: 'memories:read',
      compress_context: 'memories:read',
      load_context: 'memories:read',
      prompt_context: 'memories:read',
    };
    const scoped = all.map((tool) => {
      const requiredScope = scopeByTool[tool.name];
      return requiredScope ? { ...tool, requiredScope } : tool;
    });

    // Don't advertise export_memories when its (Postgres-only) service is absent
    // under the memory/lite profiles — the handler would only ever fail.
    const available = this.memoryExport
      ? scoped
      : scoped.filter((tool) => tool.name !== 'export_memories');

    return this.filterToolsByProfile(available);
  }

  /**
   * Filter the full tool list by the active deployment profile.
   *
   *   - profile=memory: hide `reindex_memories`, `queue_reindex_memories`,
   *     `get_reindex_status`, `cancel_reindex_job`, `retry_reindex_job`.
   *     All reindex and queue maintenance tools are excluded (in-process
   *     LTM has no vector store to backfill).
   *   - profile=lite: hide `queue_reindex_memories`, `get_reindex_status`,
   *     `cancel_reindex_job`, `retry_reindex_job` (they require a BullMQ
   *     worker). Keep `reindex_memories` as a synchronous in-process
   *     operation.
   *   - profile=enterprise: expose every tool.
   */
  private filterToolsByProfile(all: Tool[]): Tool[] {
    const capabilities = resolveCapabilities(this.activeProfile);
    const exclude = new Set<string>();

    if (capabilities.profile === DeploymentProfile.MEMORY) {
      exclude.add('reindex_memories');
      exclude.add('queue_reindex_memories');
      exclude.add('get_reindex_status');
      exclude.add('cancel_reindex_job');
      exclude.add('retry_reindex_job');
    } else if (capabilities.profile === DeploymentProfile.LITE) {
      exclude.add('queue_reindex_memories');
      exclude.add('get_reindex_status');
      exclude.add('cancel_reindex_job');
      exclude.add('retry_reindex_job');
    }

    if (exclude.size === 0) {
      return all;
    }
    return all.filter((tool) => !exclude.has(tool.name));
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
