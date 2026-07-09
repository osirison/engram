import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { assertCanManageUser, protectedProcedure, router } from '../trpc';
import { buildVaultZipBase64 } from '../../backend/vault-zip';

const userId = z.string().min(1, 'A user is required.').max(256);
const memoryId = z.string().min(1).max(256);

const listInput = z.object({
  userId,
  type: z.enum(['all', 'short-term', 'long-term']).default('all'),
  tags: z.array(z.string()).max(50).optional(),
  scope: z.string().max(256).nullish(),
  search: z.string().max(512).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  insightsOnly: z.boolean().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.string().nullish(),
});

const listStmInput = z
  .object({
    userId,
    tags: z.array(z.string()).max(50).optional(),
    scope: z.string().max(256).nullish(),
    limit: z.number().int().min(1).max(100).default(25),
    // Opaque Redis SCAN cursor from a previous page.
    cursor: z.string().max(256).nullish(),
  })
  .strict();

const searchInput = z.object({
  userId,
  query: z.string().min(1, 'Enter a search query.').max(512),
  limit: z.number().int().min(1).max(50).default(20),
  tags: z.array(z.string()).max(50).optional(),
  scope: z.string().max(256).nullish(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

const updateInput = z.object({
  userId,
  memoryId,
  content: z.string().min(1).max(10_240).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  scope: z.string().max(256).nullish(),
  // STM-only: reset the TTL window on save (mirrors update-memory.dto.ts).
  ttl: z.number().int().min(60).max(604800).optional(),
  // Optimistic-concurrency guard (WP2 T4).
  expectedVersion: z.number().int().min(1).optional(),
});

const deleteInput = z.object({
  userId,
  memoryId,
  scope: z.string().max(256).nullish(),
});

// WP3 T8: markdown-vault export filters.
const exportInput = z.object({
  userId,
  includeStm: z.boolean().optional(),
  includeHistory: z.boolean().optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  scope: z.string().max(256).nullish(),
  type: z.enum(['short-term', 'long-term']).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  mode: z.enum(['multi', 'single']).optional(),
});

export const memoryRouter = router({
  // WP3 T8: export the user's memories as an Obsidian-compatible markdown vault,
  // returned as a base64 zip the browser decodes and downloads. Reuses the
  // scope-gated, delegable `export_memories` MCP tool through the backend.
  export: protectedProcedure.input(exportInput).mutation(async ({ ctx, input }) => {
    assertCanManageUser(ctx.session, input.userId);
    const { files, manifest } = await ctx.backend.exportMemories({
      userId: input.userId,
      includeStm: input.includeStm,
      includeHistory: input.includeHistory,
      tags: input.tags,
      scope: input.scope ?? undefined,
      type: input.type,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      mode: input.mode,
    });
    const zipBase64 = await buildVaultZipBase64(files);
    const counts =
      manifest && typeof manifest === 'object' && 'counts' in manifest
        ? (manifest as { counts: unknown }).counts
        : null;
    return {
      fileName: 'engram-memories.zip',
      fileCount: Object.keys(files).length,
      zipBase64,
      counts,
    };
  }),

  list: protectedProcedure.input(listInput).query(({ ctx, input }) => {
    assertCanManageUser(ctx.session, input.userId);
    return ctx.backend.listMemories({
      userId: input.userId,
      type: input.type,
      tags: input.tags,
      scope: input.scope ?? undefined,
      search: input.search,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      insightsOnly: input.insightsOnly,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
      limit: input.limit,
      cursor: input.cursor ?? undefined,
    });
  }),

  // Live short-term (Redis) tier — served through the MCP server, never the DB.
  listStm: protectedProcedure.input(listStmInput).query(({ ctx, input }) => {
    assertCanManageUser(ctx.session, input.userId);
    return ctx.backend.listStmMemories({
      userId: input.userId,
      tags: input.tags,
      scope: input.scope ?? undefined,
      limit: input.limit,
      cursor: input.cursor ?? undefined,
    });
  }),

  get: protectedProcedure.input(z.object({ userId, memoryId })).query(async ({ ctx, input }) => {
    assertCanManageUser(ctx.session, input.userId);
    const memory = await ctx.backend.getMemory(input.userId, input.memoryId);
    if (!memory) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Memory not found.' });
    }
    return memory;
  }),

  search: protectedProcedure.input(searchInput).query(({ ctx, input }) => {
    assertCanManageUser(ctx.session, input.userId);
    return ctx.backend.searchMemories({
      userId: input.userId,
      query: input.query,
      limit: input.limit,
      tags: input.tags,
      scope: input.scope ?? undefined,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
    });
  }),

  update: protectedProcedure.input(updateInput).mutation(({ ctx, input }) => {
    assertCanManageUser(ctx.session, input.userId);
    return ctx.backend.updateMemory({
      userId: input.userId,
      memoryId: input.memoryId,
      content: input.content,
      tags: input.tags,
      scope: input.scope ?? undefined,
      ttl: input.ttl,
      expectedVersion: input.expectedVersion,
      // Audit label is the signed-in operator, injected server-side — never
      // trusted from the browser (WP2 T5).
      actorLabel: ctx.session?.user?.email ?? undefined,
    });
  }),

  reembed: protectedProcedure
    .input(z.object({ userId, memoryId, scope: z.string().max(256).nullish() }))
    .mutation(({ ctx, input }) => {
      assertCanManageUser(ctx.session, input.userId);
      return ctx.backend.reembedMemory(
        input.userId,
        input.memoryId,
        input.scope ?? undefined,
        ctx.session?.user?.email ?? undefined
      );
    }),

  // Promote a short-term memory to long-term storage (WP2 T3).
  promote: protectedProcedure.input(z.object({ userId, memoryId })).mutation(({ ctx, input }) => {
    assertCanManageUser(ctx.session, input.userId);
    return ctx.backend.promoteMemory(
      input.userId,
      input.memoryId,
      ctx.session?.user?.email ?? undefined
    );
  }),

  // Audit history for a memory (WP2 T5). Read-only; served from Postgres.
  auditLog: protectedProcedure
    .input(z.object({ userId, memoryId, limit: z.number().int().min(1).max(200).default(50) }))
    .query(({ ctx, input }) => {
      assertCanManageUser(ctx.session, input.userId);
      return ctx.backend.listMemoryAudit(input.userId, input.memoryId, input.limit);
    }),

  // Restore a hard-deleted memory from its delete snapshot (WP2 T5/G5).
  restore: protectedProcedure.input(z.object({ userId, memoryId })).mutation(({ ctx, input }) => {
    assertCanManageUser(ctx.session, input.userId);
    return ctx.backend.restoreMemory(
      input.userId,
      input.memoryId,
      ctx.session?.user?.email ?? undefined
    );
  }),

  delete: protectedProcedure.input(deleteInput).mutation(async ({ ctx, input }) => {
    assertCanManageUser(ctx.session, input.userId);
    const result = await ctx.backend.deleteMemory({
      userId: input.userId,
      memoryId: input.memoryId,
      scope: input.scope ?? undefined,
      actorLabel: ctx.session?.user?.email ?? undefined,
    });
    // A truthful {deleted:false} (WP2 T2/A10) means the row was already gone —
    // surface it as NOT_FOUND rather than a false success.
    if (!result.deleted) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Memory not found.' });
    }
    return result;
  }),

  // Bulk delete up to 100 memories in one MCP call (WP2 T6).
  bulkDelete: protectedProcedure
    .input(
      z
        .object({
          userId,
          memoryIds: z.array(memoryId).min(1).max(100),
          scope: z.string().max(256).nullish(),
        })
        .strict()
    )
    .mutation(({ ctx, input }) => {
      assertCanManageUser(ctx.session, input.userId);
      return ctx.backend.bulkDeleteMemories({
        userId: input.userId,
        memoryIds: input.memoryIds,
        scope: input.scope ?? undefined,
        actorLabel: ctx.session?.user?.email ?? undefined,
      });
    }),
});
