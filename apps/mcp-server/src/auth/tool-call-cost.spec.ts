import { toolCallUnits } from './tool-call-cost';
import {
  INGEST_CHUNK_CHAR_LIMIT,
  INGEST_MAX_CHUNKS,
  countConversationChunks,
} from '../memory/conversation-chunking';

describe('toolCallUnits', () => {
  it('charges one unit for ordinary tools', () => {
    expect(toolCallUnits('recall', { userId: 'u', query: 'q' })).toBe(1);
    expect(toolCallUnits('remember', { content: 'x'.repeat(100_000) })).toBe(1);
    expect(toolCallUnits('ping', undefined)).toBe(1);
  });

  it('charges ingest_conversation one unit per turn for normal-sized turns', () => {
    const args = {
      userId: 'u',
      turns: [
        { role: 'user', content: 'What is TypeScript?' },
        { role: 'assistant', content: 'A typed superset of JavaScript.' },
        { role: 'user', content: 'Thanks!' },
      ],
    };
    expect(toolCallUnits('ingest_conversation', args)).toBe(3);
  });

  it('charges per chunk, not per turn, when turns exceed the chunk limit', () => {
    // A single ~30 KB turn splits into multiple 10 KB chunks.
    const turns = [
      { role: 'user', content: 'X'.repeat(3 * INGEST_CHUNK_CHAR_LIMIT) },
    ];
    const units = toolCallUnits('ingest_conversation', { userId: 'u', turns });
    expect(units).toBeGreaterThanOrEqual(3);
    // Exactly the count the ingest path will produce.
    expect(units).toBe(countConversationChunks(turns));
  });

  it('clamps units at INGEST_MAX_CHUNKS for an over-cap request (#204)', () => {
    // A few oversized turns expand past the 500-chunk cap. Such a request is
    // rejected by the schema before any remember() runs, so the meter must not
    // charge more than the maximum legitimate ingest against shared buckets.
    const bigContent = 'X'.repeat(90 * INGEST_CHUNK_CHAR_LIMIT);
    const turns = Array.from({ length: 6 }, () => ({
      role: 'user',
      content: bigContent,
    }));
    expect(countConversationChunks(turns)).toBeGreaterThan(INGEST_MAX_CHUNKS);
    expect(toolCallUnits('ingest_conversation', { userId: 'u', turns })).toBe(
      INGEST_MAX_CHUNKS,
    );
  });

  it.each([
    ['null args', null],
    ['non-object args', 'turns'],
    ['array args', [{ role: 'user', content: 'hi' }]],
    ['missing turns', { userId: 'u' }],
    ['turns not an array', { turns: 'hello' }],
    ['empty turns', { turns: [] }],
    ['turn is not an object', { turns: ['hi'] }],
    [
      'turn with non-string content',
      { turns: [{ role: 'user', content: 42 }] },
    ],
    ['turn with missing role', { turns: [{ content: 'hi' }] }],
  ])(
    'charges one unit for malformed arguments (%s) — Zod rejects them at dispatch',
    (_label, args) => {
      expect(toolCallUnits('ingest_conversation', args)).toBe(1);
    },
  );
});
