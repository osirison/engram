import { readFileSync } from 'node:fs';

/**
 * A single user/assistant text turn extracted from a session transcript.
 * Tool calls, tool results, and thinking blocks are intentionally excluded —
 * they are noisy and a common vector for secret/prompt-injection leakage (R6/R9).
 */
export interface TranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** Upper bound on extracted characters fed to distillation — keeps LLM cost bounded. */
const MAX_TRANSCRIPT_CHARS = 60_000;

interface ContentBlock {
  type?: string;
  text?: string;
}

/** Pull plain text out of a message `content` that may be a string or an array of blocks. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        const b = block as ContentBlock;
        // Only keep first-party text; drop tool_use / tool_result / thinking blocks.
        return b && b.type === 'text' && typeof b.text === 'string' ? b.text : '';
      })
      .filter((t) => t.length > 0)
      .join('\n');
  }
  return '';
}

/**
 * Parse a Claude Code JSONL transcript into user/assistant text turns.
 *
 * IMPORTANT: the transcript line format is an internal Claude Code implementation
 * detail and "can break on any release" (official docs). This parser is therefore
 * deliberately tolerant: it skips any line it cannot understand and NEVER throws.
 * If the format changes so much that nothing is recognized, it returns `[]` and
 * the caller treats capture as a safe no-op.
 */
export function parseTranscript(raw: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = obj['type'];
    if (type !== 'user' && type !== 'assistant') continue;
    const message = obj['message'] as { content?: unknown } | undefined;
    const text = extractText(message?.content).trim();
    if (text.length === 0) continue;
    turns.push({ role: type, text });
  }
  return turns;
}

/**
 * Render turns into a bounded plain-text conversation for the distillation prompt.
 * Keeps the most recent content when the transcript exceeds the char budget.
 */
export function renderTurns(
  turns: readonly TranscriptTurn[],
  maxChars = MAX_TRANSCRIPT_CHARS
): string {
  const blocks = turns.map((t) => `${t.role.toUpperCase()}: ${t.text}`);
  let text = blocks.join('\n\n');
  if (text.length > maxChars) {
    text = text.slice(text.length - maxChars);
  }
  return text;
}

/** Read and parse a transcript file, returning [] on any I/O or parse failure. */
export function readTranscriptFile(path: string): TranscriptTurn[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  return parseTranscript(raw);
}
