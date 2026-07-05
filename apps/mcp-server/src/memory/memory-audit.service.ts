import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@engram/database';
import type { ToolCallContext } from '@engram/core';

/** A memory mutation worth auditing (WP2 T5/D6). */
export type MemoryAuditAction =
  | 'update'
  | 'delete'
  | 'bulk-delete'
  | 'promote'
  | 'reembed'
  | 'restore';

/** Snapshot fields captured before a destructive/mutating op. */
export interface MemorySnapshot {
  content?: string;
  tags?: string[];
  metadata?: unknown;
  type?: string;
  scope?: string | null;
  expiresAt?: string | null;
  version?: number;
}

/** One append-only audit entry. */
export interface MemoryAuditEntry {
  memoryId: string;
  userId: string;
  organizationId?: string | null;
  scope?: string | null;
  action: MemoryAuditAction;
  /** Verified actor facts from the dispatch (never trusted from tool input). */
  context?: ToolCallContext;
  /** Untrusted display label injected server-side (e.g. operator email). */
  actorLabel?: string | null;
  before?: MemorySnapshot | null;
  after?: Record<string, unknown> | null;
}

/**
 * Writes the append-only `memory_audits` trail (WP2 T5/D6/G5).
 *
 * Auditing lives here — the mcp-server layer that sees the verified principal and
 * delegation decision — not in `apps/web`, which would miss every agent-originated
 * mutation and cannot write to the read-only web DB role (GAPS A7).
 *
 * `record()` is best-effort: it NEVER throws and NEVER blocks the mutation. A lost
 * audit row must not fail a memory write, so every failure is logged and swallowed.
 */
@Injectable()
export class MemoryAuditService {
  private readonly logger = new Logger(MemoryAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: MemoryAuditEntry): Promise<void> {
    try {
      const actorId = entry.context?.apiKeyId;
      // A call carrying a verified api-key id is attributed to that key; anything
      // else (unauthenticated/legacy) is 'anonymous'.
      const actorType = actorId ? 'api-key' : 'anonymous';
      await this.prisma.memoryAudit.create({
        data: {
          memoryId: entry.memoryId,
          userId: entry.userId,
          organizationId: entry.organizationId ?? null,
          scope: entry.scope ?? null,
          action: entry.action,
          actorType,
          actorId: actorId ?? null,
          actorLabel: entry.actorLabel ?? null,
          delegated: entry.context?.delegated ?? false,
          before: (entry.before ?? null) as never,
          after: (entry.after ?? null) as never,
        },
      });
    } catch (error) {
      // Never surface an audit failure to the caller — the mutation already
      // happened (or is about to); losing the audit row must not break it.
      this.logger.error(
        `Failed to write memory audit (action=${entry.action} memory=${entry.memoryId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * List audit rows for a memory, newest first. Read path stays on Prisma (the
   * mcp-server DB role can read); the web console reads this directly.
   */
  async list(
    userId: string,
    memoryId: string,
    limit = 50,
  ): Promise<
    Array<{
      id: string;
      action: string;
      actorType: string;
      actorLabel: string | null;
      delegated: boolean;
      before: unknown;
      after: unknown;
      createdAt: Date;
    }>
  > {
    return this.prisma.memoryAudit.findMany({
      where: { userId, memoryId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      select: {
        id: true,
        action: true,
        actorType: true,
        actorLabel: true,
        delegated: true,
        before: true,
        after: true,
        createdAt: true,
      },
    });
  }

  /**
   * The newest `delete` snapshot for a memory — the source for `restore_memory`
   * (WP2 T5/G5). Returns null when there is no recoverable delete.
   */
  async findLatestDeleteSnapshot(
    userId: string,
    memoryId: string,
  ): Promise<{
    before: MemorySnapshot;
    scope: string | null;
    organizationId: string | null;
  } | null> {
    const row = await this.prisma.memoryAudit.findFirst({
      where: { userId, memoryId, action: 'delete' },
      orderBy: { createdAt: 'desc' },
      select: { before: true, scope: true, organizationId: true },
    });
    if (!row || !row.before || typeof row.before !== 'object') {
      return null;
    }
    return {
      before: row.before as MemorySnapshot,
      scope: row.scope,
      organizationId: row.organizationId,
    };
  }
}
