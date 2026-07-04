import {
  ingestConversationToolSchema,
  INGEST_MAX_CHUNKS,
} from './ingest-conversation.dto';
import { countConversationChunks } from '../conversation-chunking';

// A valid cuid1 accepted by userIdSchema.
const USER_ID = 'cjld2cyuq0000t3rmniod1foy';

describe('ingestConversationToolSchema', () => {
  it('accepts a normal conversation within the chunk cap', () => {
    const result = ingestConversationToolSchema.safeParse({
      userId: USER_ID,
      turns: [
        { role: 'user', content: 'Hello, what is TypeScript?' },
        { role: 'assistant', content: 'A typed superset of JavaScript.' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a conversation that expands past INGEST_MAX_CHUNKS (#204)', () => {
    // A handful of oversized single-paragraph turns blow past the 500-chunk cap
    // while staying within the 500-turn and 1 MB-per-turn limits — exactly the
    // amplification (one request → hundreds of remember() calls) the cap stops.
    const bigContent = 'X'.repeat(90 * 10_240);
    const turns = Array.from({ length: 6 }, () => ({
      role: 'user',
      content: bigContent,
    }));
    // Sanity-check the fixture really exceeds the cap (guards against arithmetic
    // drift if the chunk limit ever changes).
    expect(countConversationChunks(turns)).toBeGreaterThan(INGEST_MAX_CHUNKS);

    const result = ingestConversationToolSchema.safeParse({
      userId: USER_ID,
      turns,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message).join(' ')).toMatch(
        /exceeding the maximum of 500/,
      );
    }
  });

  it('rejects more than 500 turns outright', () => {
    const turns = Array.from({ length: 501 }, (_, i) => ({
      role: 'user',
      content: `t${i}`,
    }));
    expect(
      ingestConversationToolSchema.safeParse({ userId: USER_ID, turns })
        .success,
    ).toBe(false);
  });
});
