/**
 * Pure helpers for splitting conversation turns into storable chunks.
 *
 * Shared by:
 *   - `MemoryService.ingestConversation` (the actual chunk-and-store fan-out),
 *   - the `ingest_conversation` Zod schema (rejecting requests whose chunk
 *     fan-out exceeds {@link INGEST_MAX_CHUNKS}),
 *   - the MCP rate-limit middleware (charging one rate-limit unit per chunk so
 *     a single `tools/call` cannot amplify into hundreds of unmetered
 *     embedding/DB operations — see issue #204).
 *
 * Keeping the split logic in one place guarantees the cap, the meter, and the
 * ingest itself always agree on the chunk count.
 */

/** Max characters per stored chunk (single-memory size cap). */
export const INGEST_CHUNK_CHAR_LIMIT = 10_240;

/**
 * Hard cap on the total chunks a single `ingest_conversation` request may
 * expand to. Each turn yields at least one chunk, so this cap (aligned with
 * the schema's 500-turn maximum) never rejects a conversation of normal-sized
 * turns — it only stops oversized turns from amplifying one request into an
 * unbounded number of `remember()` calls (embedding + vector search + DB
 * write each). Requests above the cap are rejected with a clear error; the
 * per-chunk rate-limit charge governs sustained throughput below it.
 */
export const INGEST_MAX_CHUNKS = 500;

export interface ConversationTurn {
  role: string;
  content: string;
}

/**
 * Format conversation turns into storable chunks ≤ `charLimit` chars each.
 * Each turn becomes "<role>: <content>". Turns exceeding the limit are split
 * at double-newline boundaries (paragraphs), falling back to hard char cuts.
 */
export function splitTurnsToChunks(
  turns: ConversationTurn[],
  charLimit = INGEST_CHUNK_CHAR_LIMIT,
): string[] {
  const chunks: string[] = [];
  for (const { role, content } of turns) {
    const formatted = `${role}: ${content}`;
    if (formatted.length <= charLimit) {
      chunks.push(formatted);
      continue;
    }
    // Split oversized turns at paragraph breaks, then hard-cut if needed
    const prefix = `${role}: `;
    const paragraphs = content.split(/\n\n+/).filter((p) => p.trim() !== '');
    if (paragraphs.length === 0) {
      // All-whitespace oversized content: hard-cut as-is to avoid silent drop
      for (let i = 0; i < formatted.length; i += charLimit) {
        chunks.push(formatted.slice(i, i + charLimit));
      }
      continue;
    }
    let current = prefix;
    for (const para of paragraphs) {
      const addition = (current === prefix ? '' : '\n\n') + para;
      if (current.length + addition.length <= charLimit) {
        current += addition;
      } else {
        if (current !== prefix) {
          chunks.push(current);
        }
        // Hard-cut: prefix every slice so each chunk is self-contained
        const chunkContent = charLimit - prefix.length;
        for (let i = 0; i < para.length; i += chunkContent) {
          chunks.push(`${prefix}${para.slice(i, i + chunkContent)}`);
        }
        current = prefix;
      }
    }
    if (current !== prefix) {
      chunks.push(current);
    }
  }
  return chunks;
}

/**
 * Number of chunks `turns` expands to when ingested. Exact by construction:
 * it runs the same splitter the ingest path uses.
 */
export function countConversationChunks(
  turns: ConversationTurn[],
  charLimit = INGEST_CHUNK_CHAR_LIMIT,
): number {
  return splitTurnsToChunks(turns, charLimit).length;
}
