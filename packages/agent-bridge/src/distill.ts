import type { DistillConfig, DistilledFact } from './types.js';
import { renderTurns, type TranscriptTurn } from './transcript.js';

/**
 * A pluggable text-completion provider. `capture` uses ONE bounded call to turn a
 * session transcript into a small set of memory-worthy facts. Injectable so tests
 * never hit the network.
 */
export interface DistillProvider {
  complete(input: { system: string; user: string }): Promise<string>;
}

/** The write rubric (docs/agent-memory-contract.md, D4) rendered as a system prompt. */
export function buildSystemPrompt(maxFacts: number): string {
  return [
    'You extract durable, reusable memories from an AI coding session for a shared memory store.',
    '',
    `Return at most ${maxFacts} facts as a JSON array. Each element:`,
    '  { "content": string (ONE fact, <=500 chars, declarative),',
    '    "tags": string[] (optional, lowercase),',
    '    "importance": number (0-1; higher for decisions/conventions) }',
    '',
    'STORE a fact only if it is durable, reusable, and NOT trivially re-derivable:',
    '  - Decisions and their rationale (what was chosen and why).',
    '  - Conventions and preferences (style, commit format, tools, naming).',
    '  - Environment and wiring facts (non-secret config, URLs, ports, how to run things).',
    '  - Gotchas and fixes (root-caused bugs and their resolution).',
    '  - Stable user/project facts (ownership, domain vocabulary).',
    '',
    'NEVER emit:',
    '  - Secrets, tokens, keys, passwords, or PII (hard block).',
    '  - Transient state (current line/file being edited).',
    '  - Facts already obvious from reading a file in the repo.',
    '  - Speculation you are not confident is true.',
    '  - Large verbatim code — store the decision, not the code.',
    '',
    'If nothing is memory-worthy, return []. Output ONLY the JSON array, no prose.',
  ].join('\n');
}

/** Parse the model output into facts, tolerating fences/prose around the JSON array. */
export function parseDistilledFacts(raw: string): DistilledFact[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const facts: DistilledFact[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const content = typeof rec['content'] === 'string' ? rec['content'].trim() : '';
    if (content.length === 0) continue;
    const fact: DistilledFact = { content: content.slice(0, 500) };
    if (Array.isArray(rec['tags'])) {
      fact.tags = rec['tags']
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.toLowerCase());
    }
    if (typeof rec['importance'] === 'number' && Number.isFinite(rec['importance'])) {
      fact.importance = Math.min(1, Math.max(0, rec['importance']));
    }
    facts.push(fact);
  }
  return facts;
}

/** Run the bounded distillation. Returns [] when there is nothing to distill. */
export async function distillFacts(
  turns: readonly TranscriptTurn[],
  provider: DistillProvider,
  maxFacts: number
): Promise<DistilledFact[]> {
  if (turns.length === 0) return [];
  const system = buildSystemPrompt(maxFacts);
  const user = renderTurns(turns);
  const raw = await provider.complete({ system, user });
  return parseDistilledFacts(raw).slice(0, maxFacts);
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Default provider: a single OpenAI-compatible chat completion. Returns `null`
 * when no API key is configured, which makes `capture` a no-op (never stores raw
 * transcripts). Never logs or echoes the key.
 */
export function createOpenAiDistillProvider(
  config: DistillConfig,
  fetchImpl: typeof fetch = fetch
): DistillProvider | null {
  if (!config.apiKey) return null;
  const endpoint = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
  return {
    async complete({ system, user }): Promise<string> {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        // Bound the call so a hung LLM endpoint can't block `capture` (D5 non-blocking).
        signal: AbortSignal.timeout(config.timeoutMs ?? 20000),
      });
      if (!res.ok) {
        throw new Error(`distillation provider returned HTTP ${res.status}`);
      }
      const data = (await res.json()) as ChatCompletionResponse;
      return data.choices?.[0]?.message?.content ?? '';
    },
  };
}
