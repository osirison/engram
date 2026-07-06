import { describe, expect, it, vi } from 'vitest';

import {
  buildSystemPrompt,
  createOpenAiDistillProvider,
  distillFacts,
  parseDistilledFacts,
  type DistillProvider,
} from './distill.js';

describe('buildSystemPrompt', () => {
  it('embeds the write rubric and the fact cap', () => {
    const prompt = buildSystemPrompt(5);
    expect(prompt).toContain('at most 5 facts');
    expect(prompt).toContain('Secrets');
    expect(prompt).toContain('Decisions');
    expect(prompt).toContain('JSON array');
  });
});

describe('parseDistilledFacts', () => {
  it('parses a bare JSON array', () => {
    const facts = parseDistilledFacts(
      '[{"content":"use pnpm","tags":["Tooling"],"importance":0.9}]'
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]!.content).toBe('use pnpm');
    expect(facts[0]!.tags).toEqual(['tooling']);
    expect(facts[0]!.importance).toBe(0.9);
  });

  it('tolerates code fences and surrounding prose', () => {
    const raw = 'Here you go:\n```json\n[{"content":"commit format is conventional"}]\n```\nDone.';
    const facts = parseDistilledFacts(raw);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.content).toContain('conventional');
  });

  it('clamps importance to [0,1] and truncates long content', () => {
    const long = 'x'.repeat(900);
    const facts = parseDistilledFacts(`[{"content":"${long}","importance":5}]`);
    expect(facts[0]!.content.length).toBe(500);
    expect(facts[0]!.importance).toBe(1);
  });

  it('returns [] for junk or non-array output', () => {
    expect(parseDistilledFacts('sorry, no memories')).toEqual([]);
    expect(parseDistilledFacts('{"content":"not an array"}')).toEqual([]);
  });
});

describe('distillFacts', () => {
  it('returns [] with no turns without calling the provider', async () => {
    const provider: DistillProvider = { complete: vi.fn() };
    expect(await distillFacts([], provider, 8)).toEqual([]);
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('caps the number of returned facts', async () => {
    const provider: DistillProvider = {
      complete: async () =>
        JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ content: `fact ${i}` }))),
    };
    const facts = await distillFacts([{ role: 'user', text: 'hi' }], provider, 3);
    expect(facts).toHaveLength(3);
  });
});

describe('createOpenAiDistillProvider', () => {
  it('returns null when no API key is configured', () => {
    const provider = createOpenAiDistillProvider({
      model: 'm',
      baseUrl: 'https://x/v1',
      maxFacts: 8,
    });
    expect(provider).toBeNull();
  });

  it('posts a chat completion and returns the content, without leaking the key to logs', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '[]' } }] }), { status: 200 })
    );
    const provider = createOpenAiDistillProvider(
      {
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com/v1',
        maxFacts: 8,
      },
      fetchMock as unknown as typeof fetch
    );
    expect(provider).not.toBeNull();
    const out = await provider!.complete({ system: 's', user: 'u' });
    expect(out).toBe('[]');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as { headers: Record<string, string> }).headers['Authorization']).toBe(
      'Bearer sk-test'
    );
  });

  it('throws on a non-2xx response', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));
    const provider = createOpenAiDistillProvider(
      { apiKey: 'sk-test', model: 'm', baseUrl: 'https://x/v1', maxFacts: 8 },
      fetchMock as unknown as typeof fetch
    );
    await expect(provider!.complete({ system: 's', user: 'u' })).rejects.toThrow('HTTP 500');
  });
});
