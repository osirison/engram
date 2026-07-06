import { describe, expect, it } from 'vitest';
import { parseTranscript, readTranscriptFile, renderTurns } from './transcript.js';

describe('parseTranscript', () => {
  it('extracts user/assistant text from string and block content', () => {
    const jsonl = [
      JSON.stringify({ type: 'user', message: { content: 'why pgvector?' } }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'we chose pgvector to drop a service' }] },
      }),
    ].join('\n');
    const turns = parseTranscript(jsonl);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({ role: 'user', text: 'why pgvector?' });
    expect(turns[1]!.text).toContain('pgvector');
  });

  it('skips tool_use / tool_result / thinking blocks and non-message lines', () => {
    const jsonl = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'bash' }] },
      }),
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'tool_result', text: 'SECRET=abc' }] },
      }),
      JSON.stringify({ type: 'summary', summary: 'x' }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'real answer' }] },
      }),
    ].join('\n');
    const turns = parseTranscript(jsonl);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.text).toBe('real answer');
  });

  it('tolerates corrupt lines without throwing', () => {
    const jsonl = [
      '{ not valid json',
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      '',
    ].join('\n');
    expect(() => parseTranscript(jsonl)).not.toThrow();
    expect(parseTranscript(jsonl)).toHaveLength(1);
  });

  it('returns [] on unrecognized format (future-proofing against transcript drift)', () => {
    const jsonl = [
      JSON.stringify({ role: 'user', text: 'new format' }),
      JSON.stringify({ foo: 'bar' }),
    ].join('\n');
    expect(parseTranscript(jsonl)).toEqual([]);
  });
});

describe('renderTurns', () => {
  it('bounds output to the char budget, keeping the most recent text', () => {
    const turns = Array.from({ length: 50 }, (_, i) => ({
      role: 'user' as const,
      text: `turn ${i} `.repeat(20),
    }));
    const rendered = renderTurns(turns, 500);
    expect(rendered.length).toBeLessThanOrEqual(500);
    expect(rendered).toContain('turn 49');
  });
});

describe('readTranscriptFile', () => {
  it('returns [] when the file is missing', () => {
    expect(readTranscriptFile('/nonexistent/path/to/transcript.jsonl')).toEqual([]);
  });
});
