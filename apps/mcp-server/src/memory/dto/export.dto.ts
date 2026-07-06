import { userIdSchema } from '@engram/database';
import { z } from 'zod';

/**
 * Input for the `export_memories` MCP tool (WP3 T7). Mirrors
 * `MemoryExportOptions` but takes ISO-string dates (JSON transport) and adds
 * `maxInline`, the bound above which the result is written to a server path
 * instead of returned inline (PLAN §4.11).
 */
export const exportToolSchema = z
  .object({
    userId: userIdSchema,
    /** Include short-term (Redis) memories. Default false — LTM only. */
    includeStm: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    scope: z.string().min(1).max(256).optional(),
    type: z.enum(['short-term', 'long-term']).optional(),
    mode: z.enum(['multi', 'single']).optional(),
    /**
     * Max memory files returned inline. At or below this, documents + manifest
     * come back as JSON; above it, the export is written to a server directory
     * and only a path reference + manifest summary are returned (never a base64
     * zip — that would flood the MCP text channel).
     */
    maxInline: z.coerce.number().int().min(0).max(1000).optional().default(25),
  })
  .strict();

export type ExportToolInput = z.infer<typeof exportToolSchema>;
