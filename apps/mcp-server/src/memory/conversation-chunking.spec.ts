import {
  INGEST_CHUNK_CHAR_LIMIT,
  INGEST_MAX_CHUNKS,
  countConversationChunks,
  splitTurnsToChunks,
} from './conversation-chunking';

describe('conversation-chunking', () => {
  describe('splitTurnsToChunks', () => {
    it('returns one chunk per short turn', () => {
      const chunks = splitTurnsToChunks([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ]);
      expect(chunks).toEqual(['user: Hello', 'assistant: Hi there']);
    });

    it('splits oversized turns into chunks within the char limit', () => {
      const longContent = 'A'.repeat(6000) + '\n\n' + 'B'.repeat(6000);
      const chunks = splitTurnsToChunks([
        { role: 'user', content: longContent },
      ]);
      expect(chunks.length).toBeGreaterThan(1);
      for (const c of chunks) {
        expect(c.length).toBeLessThanOrEqual(INGEST_CHUNK_CHAR_LIMIT);
      }
    });

    it('hard-cuts a single paragraph longer than the limit, prefixing every slice', () => {
      const chunks = splitTurnsToChunks([
        { role: 'user', content: 'X'.repeat(25_000) },
      ]);
      expect(chunks.length).toBeGreaterThanOrEqual(3);
      for (const c of chunks) {
        expect(c.length).toBeLessThanOrEqual(INGEST_CHUNK_CHAR_LIMIT);
        expect(c.startsWith('user: ')).toBe(true);
      }
    });
  });

  describe('countConversationChunks', () => {
    it('always matches the length of the actual split (single source of truth)', () => {
      const cases = [
        [{ role: 'user', content: 'short' }],
        [{ role: 'user', content: 'X'.repeat(25_000) }],
        [
          {
            role: 'user',
            content: 'A'.repeat(6000) + '\n\n' + 'B'.repeat(6000),
          },
          { role: 'assistant', content: 'ok' },
        ],
        Array.from({ length: 40 }, (_, i) => ({
          role: 'user',
          content: `turn ${i}`,
        })),
      ];
      for (const turns of cases) {
        expect(countConversationChunks(turns)).toBe(
          splitTurnsToChunks(turns).length,
        );
      }
    });

    it('counts at least one chunk per turn', () => {
      const turns = Array.from({ length: 7 }, (_, i) => ({
        role: 'user',
        content: `t${i}`,
      }));
      expect(countConversationChunks(turns)).toBe(7);
    });
  });

  describe('caps', () => {
    it('caps requests at 500 chunks, matching the 500-turn schema maximum', () => {
      // Each turn yields at least one chunk, so a cap below the schema's max
      // turn count would reject conversations the schema explicitly allows.
      expect(INGEST_MAX_CHUNKS).toBe(500);
      expect(INGEST_CHUNK_CHAR_LIMIT).toBe(10_240);
    });
  });
});
