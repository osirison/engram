import { CompressionInput, CompressionOutput, ConversationTurn } from './types';

const LINE_BREAK_PATTERN = /\r?\n+/g;
const WHITESPACE_PATTERN = /\s+/g;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(WHITESPACE_PATTERN, ' ');
}

function normalizeLine(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function uniqueLines(value: string): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of value.split(LINE_BREAK_PATTERN)) {
    const line = normalizeWhitespace(rawLine);
    if (line.length === 0) {
      continue;
    }

    const normalized = normalizeLine(line);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    unique.push(line);
  }

  return unique;
}

function summarizeHistory(turns: readonly ConversationTurn[], maxChars: number): string {
  if (turns.length === 0) {
    return '';
  }

  const budget = Math.max(200, Math.floor(maxChars * 0.45));
  const slices: string[] = [];

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (!turn) {
      continue;
    }

    const rolePrefix = turn.role === 'assistant' ? 'A' : 'U';
    const normalizedText = normalizeWhitespace(turn.text);
    if (normalizedText.length === 0) {
      continue;
    }

    const candidate = `${rolePrefix}: ${normalizedText}`;
    slices.unshift(candidate);
    const snapshot = slices.join('\n');

    if (snapshot.length > budget) {
      slices.shift();
      break;
    }
  }

  return slices.join('\n');
}

function enforceBudget(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const hardTrimmed = value.slice(0, Math.max(0, maxChars - 1)).trimEnd();
  return `${hardTrimmed}…`;
}

export function compressContext(input: CompressionInput): CompressionOutput {
  const promptCore = uniqueLines(input.prompt).join('\n');
  const historySummary = summarizeHistory(input.history, input.maxChars);

  const merged =
    historySummary.length > 0
      ? `TASK\n${promptCore}\n\nRECENT_CONTEXT\n${historySummary}`
      : `TASK\n${promptCore}`;

  const compressedPrompt = enforceBudget(merged, input.maxChars);

  return {
    promptCore,
    historySummary,
    compressedPrompt,
    originalLength: input.prompt.length,
    compressedLength: compressedPrompt.length,
  };
}
