import { timingSafeEqual } from 'node:crypto';

/**
 * Compare two strings in constant time.
 *
 * Falls back to `false` when the lengths differ — we still pay for a
 * `timingSafeEqual` over a zero-padded pair so the rejection latency does
 * not leak the length of the expected token.
 *
 * Callers must supply UTF-8 inputs (typically admin tokens issued as
 * printable ASCII). Non-string inputs are rejected without comparison so
 * a `number` cannot accidentally bypass the check.
 */
export function constantTimeStringEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    const max = Math.max(aBuf.length, bBuf.length, 1);
    const paddedA = Buffer.alloc(max);
    const paddedB = Buffer.alloc(max);
    aBuf.copy(paddedA);
    bBuf.copy(paddedB);
    // Pay the constant-time cost on a padded buffer so the rejection
    // latency is independent of the actual mismatch position.
    timingSafeEqual(paddedA, paddedB);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}
