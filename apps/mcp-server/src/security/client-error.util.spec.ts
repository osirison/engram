import { z } from 'zod';
import {
  ClientFacingError,
  GENERIC_CLIENT_ERROR_DETAIL,
  toClientError,
} from './client-error.util';

describe('toClientError', () => {
  const PREFIX = 'Failed to do the thing';

  it('surfaces Zod issue messages (they describe the client input)', () => {
    const schema = z
      .object({ userId: z.string().min(1, 'userId cannot be empty') })
      .strict();
    const result = schema.safeParse({ userId: '' });
    if (result.success) {
      throw new Error('expected validation to fail');
    }

    const err = toClientError(result.error, PREFIX);
    expect(err.message).toBe(`${PREFIX}: userId cannot be empty`);
  });

  it('joins multiple Zod issues with semicolons', () => {
    const schema = z
      .object({
        a: z.string().min(1, 'a is required'),
        b: z.string().min(1, 'b is required'),
      })
      .strict();
    const result = schema.safeParse({ a: '', b: '' });
    if (result.success) {
      throw new Error('expected validation to fail');
    }
    const err = toClientError(result.error, PREFIX);
    expect(err.message).toBe(`${PREFIX}: a is required; b is required`);
  });

  it('surfaces ClientFacingError messages verbatim', () => {
    const err = toClientError(
      new ClientFacingError('Unauthorized maintenance operation'),
      PREFIX,
    );
    expect(err.message).toBe(`${PREFIX}: Unauthorized maintenance operation`);
  });

  it('replaces plain Error messages with the generic detail', () => {
    const err = toClientError(
      new Error(
        'connect ECONNREFUSED 10.0.0.5:5432 (postgresql://engram:s3cret@db/engram)',
      ),
      PREFIX,
    );
    expect(err.message).toBe(`${PREFIX}: ${GENERIC_CLIENT_ERROR_DETAIL}`);
    expect(err.message).not.toContain('ECONNREFUSED');
    expect(err.message).not.toContain('s3cret');
  });

  it('replaces Prisma-style structured errors with the generic detail', () => {
    class FakePrismaError extends Error {
      code = 'P2002';
      meta = { target: ['memories_user_id_content_hash_key'] };
    }
    const err = toClientError(
      new FakePrismaError(
        'Unique constraint failed on the fields: (`userId`,`contentHash`)',
      ),
      PREFIX,
    );
    expect(err.message).toBe(`${PREFIX}: ${GENERIC_CLIENT_ERROR_DETAIL}`);
    expect(err.message).not.toContain('Unique constraint');
  });

  it('handles non-Error values without leaking them', () => {
    const err = toClientError('raw string with internals', PREFIX);
    expect(err.message).toBe(`${PREFIX}: ${GENERIC_CLIENT_ERROR_DETAIL}`);
  });
});
