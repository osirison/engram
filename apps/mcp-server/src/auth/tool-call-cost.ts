/**
 * Work-proportional rate-limit costs for MCP tool calls.
 *
 * Most tools perform O(1) downstream work and cost one unit. A few fan out:
 * `ingest_conversation` chunks its turns at 10 KB and calls `remember()`
 * (embedding + vector search + DB write) once per chunk — up to hundreds of
 * operations from a single `tools/call`. Charging one unit per chunk makes the
 * limiter meter the actual work instead of the request count (issue #204).
 */
import {
  INGEST_MAX_CHUNKS,
  countConversationChunks,
  type ConversationTurn,
} from '../memory/conversation-chunking';

const INGEST_CONVERSATION_TOOL = 'ingest_conversation';

/**
 * Best-effort extraction of `turns` from raw, not-yet-validated tool
 * arguments. Returns null when the shape is unusable — such requests are
 * charged a single unit and then rejected by Zod at dispatch before any
 * fan-out work happens, so under-charging them is safe.
 */
function parseTurns(args: unknown): ConversationTurn[] | null {
  if (args == null || typeof args !== 'object' || Array.isArray(args)) {
    return null;
  }
  const turns = (args as { turns?: unknown }).turns;
  if (!Array.isArray(turns) || turns.length === 0) return null;

  const parsed: ConversationTurn[] = [];
  for (const turn of turns) {
    if (turn == null || typeof turn !== 'object' || Array.isArray(turn)) {
      return null;
    }
    const { role, content } = turn as { role?: unknown; content?: unknown };
    if (typeof role !== 'string' || typeof content !== 'string') return null;
    parsed.push({ role, content });
  }
  return parsed;
}

/**
 * Rate-limit units a single `tools/call` should be charged.
 * One unit for ordinary tools; one unit per stored chunk for
 * `ingest_conversation` (exactly the chunking the ingest path performs).
 *
 * Clamped to {@link INGEST_MAX_CHUNKS}: a request whose chunk count exceeds the
 * cap is rejected by the schema before any `remember()` runs (#204), so it does
 * zero downstream work. Charging it more than the maximum legitimate ingest
 * would only let a to-be-rejected request drain the shared user/org budget past
 * the real work ceiling, penalizing co-tenants — so the meter tops out at the
 * cap the ingest can actually reach.
 */
export function toolCallUnits(name: string, args: unknown): number {
  if (name !== INGEST_CONVERSATION_TOOL) return 1;
  const turns = parseTurns(args);
  if (turns == null) return 1;
  return Math.min(
    INGEST_MAX_CHUNKS,
    Math.max(1, countConversationChunks(turns)),
  );
}
