import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { MetricsTokenGuard } from './metrics-token.guard';

const makeContext = (
  headers: Record<string, string | string[] | undefined>,
): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  }) as unknown as ExecutionContext;

describe('MetricsTokenGuard', () => {
  let guard: MetricsTokenGuard;
  const originalToken = process.env.METRICS_TOKEN;

  beforeEach(() => {
    guard = new MetricsTokenGuard();
    delete process.env.METRICS_TOKEN;
  });

  afterAll(() => {
    if (originalToken === undefined) {
      delete process.env.METRICS_TOKEN;
    } else {
      process.env.METRICS_TOKEN = originalToken;
    }
  });

  describe('when METRICS_TOKEN is unset (default open posture)', () => {
    it('allows requests without any credential', () => {
      expect(guard.canActivate(makeContext({}))).toBe(true);
    });
  });

  describe('when METRICS_TOKEN is set', () => {
    beforeEach(() => {
      process.env.METRICS_TOKEN = 'scrape-token-123';
    });

    it('rejects requests without a token', () => {
      expect(() => guard.canActivate(makeContext({}))).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a wrong bearer token', () => {
      expect(() =>
        guard.canActivate(makeContext({ authorization: 'Bearer wrong-token' })),
      ).toThrow(UnauthorizedException);
    });

    it('rejects a wrong X-Metrics-Token header', () => {
      expect(() =>
        guard.canActivate(makeContext({ 'x-metrics-token': 'nope' })),
      ).toThrow(UnauthorizedException);
    });

    it('accepts the token via Authorization: Bearer', () => {
      expect(
        guard.canActivate(
          makeContext({ authorization: 'Bearer scrape-token-123' }),
        ),
      ).toBe(true);
    });

    it('accepts the bearer scheme case-insensitively', () => {
      expect(
        guard.canActivate(
          makeContext({ authorization: 'bearer scrape-token-123' }),
        ),
      ).toBe(true);
    });

    it('accepts the token via X-Metrics-Token', () => {
      expect(
        guard.canActivate(
          makeContext({ 'x-metrics-token': 'scrape-token-123' }),
        ),
      ).toBe(true);
    });

    it('rejects an empty bearer credential', () => {
      expect(() =>
        guard.canActivate(makeContext({ authorization: 'Bearer ' })),
      ).toThrow(UnauthorizedException);
    });

    it('rejects array-valued headers (no accidental coercion)', () => {
      expect(() =>
        guard.canActivate(
          makeContext({ 'x-metrics-token': ['scrape-token-123'] }),
        ),
      ).toThrow(UnauthorizedException);
    });

    it('does not fall back to a non-bearer Authorization scheme', () => {
      expect(() =>
        guard.canActivate(
          makeContext({ authorization: 'Basic scrape-token-123' }),
        ),
      ).toThrow(UnauthorizedException);
    });
  });
});
