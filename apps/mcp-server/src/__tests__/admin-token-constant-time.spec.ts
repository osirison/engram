import { constantTimeStringEqual } from '../security/admin-token.util';

/**
 * Pure-function test for the constant-time admin token helper.
 *
 * The integration with the controller is exercised indirectly via the
 * existing memory.controller unit tests; here we focus on the helper
 * itself to keep the assertions fast and the failure modes isolated.
 */
describe('constantTimeStringEqual', () => {
  it('returns true for identical strings', () => {
    expect(
      constantTimeStringEqual('mcp-admin-token-123', 'mcp-admin-token-123'),
    ).toBe(true);
  });

  it('returns false for strings of the same length that differ', () => {
    expect(
      constantTimeStringEqual('mcp-admin-token-123', 'mcp-admin-token-124'),
    ).toBe(false);
  });

  it('returns false for strings of different lengths', () => {
    expect(constantTimeStringEqual('short', 'longer-string')).toBe(false);
    expect(constantTimeStringEqual('longer-string', 'short')).toBe(false);
  });

  it('handles empty strings symmetrically', () => {
    expect(constantTimeStringEqual('', '')).toBe(true);
    expect(constantTimeStringEqual('', 'x')).toBe(false);
    expect(constantTimeStringEqual('x', '')).toBe(false);
  });

  it('rejects non-string inputs without comparison', () => {
    expect(constantTimeStringEqual(undefined as unknown as string, 'x')).toBe(
      false,
    );
    expect(constantTimeStringEqual('x', null as unknown as string)).toBe(false);
    expect(
      constantTimeStringEqual(42 as unknown as string, 42 as unknown as string),
    ).toBe(false);
  });
});
