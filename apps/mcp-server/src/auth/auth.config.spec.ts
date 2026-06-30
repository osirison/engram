import {
  buildOAuthProviders,
  isAuthRequired,
  isFlagEnabled,
  oauthRedirectBaseUrl,
  parseDurationToSeconds,
  parseJwtConfig,
  parseRateLimitConfig,
} from './auth.config';

const SECRET = 'unit-test-secret-at-least-32-characters-long';

describe('auth.config', () => {
  describe('isFlagEnabled', () => {
    it.each(['true', '1', 'yes', 'on', 'TRUE', ' On '])(
      'is true for %p',
      (value) => {
        expect(isFlagEnabled(value)).toBe(true);
      },
    );

    it.each([undefined, '', 'false', '0', 'no', 'off', 'maybe'])(
      'is false for %p',
      (value) => {
        expect(isFlagEnabled(value)).toBe(false);
      },
    );
  });

  describe('parseDurationToSeconds', () => {
    it('returns the fallback when value is undefined', () => {
      expect(parseDurationToSeconds(undefined, 42)).toBe(42);
    });

    it('treats a plain integer as seconds', () => {
      expect(parseDurationToSeconds('3600')).toBe(3600);
    });

    it.each([
      ['30s', 30],
      ['30m', 1800],
      ['24h', 86_400],
      ['7d', 604_800],
      ['2H', 7200],
    ])('parses %p', (value, expected) => {
      expect(parseDurationToSeconds(value)).toBe(expected);
    });

    it('returns the fallback for unrecognised input', () => {
      expect(parseDurationToSeconds('not-a-duration', 99)).toBe(99);
      expect(parseDurationToSeconds('10y', 99)).toBe(99);
    });
  });

  describe('parseJwtConfig', () => {
    it('returns null when no secret is configured', () => {
      expect(parseJwtConfig({})).toBeNull();
    });

    it('returns null when the secret is too short', () => {
      expect(parseJwtConfig({ JWT_SECRET: 'short' })).toBeNull();
    });

    it('returns config with a default TTL when valid', () => {
      expect(parseJwtConfig({ JWT_SECRET: SECRET })).toEqual({
        secret: SECRET,
        expiresInSeconds: 7 * 24 * 60 * 60,
      });
    });

    it('honours JWT_EXPIRES_IN', () => {
      expect(
        parseJwtConfig({ JWT_SECRET: SECRET, JWT_EXPIRES_IN: '1h' }),
      ).toEqual({ secret: SECRET, expiresInSeconds: 3600 });
    });
  });

  describe('oauthRedirectBaseUrl', () => {
    it('defaults to localhost on the default port', () => {
      expect(oauthRedirectBaseUrl({})).toBe('http://localhost:3000');
    });

    it('uses PORT when set', () => {
      expect(oauthRedirectBaseUrl({ PORT: '8080' })).toBe(
        'http://localhost:8080',
      );
    });

    it('strips trailing slashes from an explicit base URL', () => {
      expect(
        oauthRedirectBaseUrl({ OAUTH_REDIRECT_BASE_URL: 'https://x.test/' }),
      ).toBe('https://x.test');
    });
  });

  describe('buildOAuthProviders', () => {
    it('returns no providers when no credentials are configured', () => {
      expect(buildOAuthProviders({})).toHaveLength(0);
    });

    it('builds only GitHub when only its credentials are present', () => {
      const providers = buildOAuthProviders({
        GITHUB_CLIENT_ID: 'id',
        GITHUB_CLIENT_SECRET: 'secret',
      });
      expect(providers.map((p) => p.name)).toEqual(['github']);
    });

    it('builds both providers when both are configured', () => {
      const providers = buildOAuthProviders({
        GITHUB_CLIENT_ID: 'id',
        GITHUB_CLIENT_SECRET: 'secret',
        GOOGLE_CLIENT_ID: 'gid',
        GOOGLE_CLIENT_SECRET: 'gsecret',
      });
      expect(providers.map((p) => p.name).sort()).toEqual(['github', 'google']);
    });
  });

  describe('parseRateLimitConfig', () => {
    it('uses defaults when nothing is set', () => {
      expect(parseRateLimitConfig({})).toEqual({
        enabled: false,
        windowSeconds: 60,
        userRpm: 120,
        orgRpm: 6000,
        ipRpm: 60,
        toolOverrides: {},
      });
    });

    it('parses numeric overrides and the enabled flag', () => {
      const config = parseRateLimitConfig({
        RATE_LIMIT_ENABLED: 'true',
        RATE_LIMIT_WINDOW_SEC: '30',
        RATE_LIMIT_USER_RPM: '10',
        RATE_LIMIT_ORG_RPM: '100',
        RATE_LIMIT_IP_RPM: '5',
      });
      expect(config).toMatchObject({
        enabled: true,
        windowSeconds: 30,
        userRpm: 10,
        orgRpm: 100,
        ipRpm: 5,
      });
    });

    it('falls back to defaults for non-positive / non-numeric values', () => {
      const config = parseRateLimitConfig({
        RATE_LIMIT_WINDOW_SEC: '0',
        RATE_LIMIT_USER_RPM: '-5',
        RATE_LIMIT_IP_RPM: 'abc',
      });
      expect(config).toMatchObject({
        windowSeconds: 60,
        userRpm: 120,
        ipRpm: 60,
      });
    });

    it('accepts a valid tool-overrides JSON object', () => {
      const config = parseRateLimitConfig({
        RATE_LIMIT_TOOL_OVERRIDES: JSON.stringify({
          recall: { limit: 5, windowSeconds: 10 },
        }),
      });
      expect(config.toolOverrides).toEqual({
        recall: { limit: 5, windowSeconds: 10 },
      });
    });

    it('ignores malformed override JSON (defensive fallback)', () => {
      expect(
        parseRateLimitConfig({ RATE_LIMIT_TOOL_OVERRIDES: '{ not json' })
          .toolOverrides,
      ).toEqual({});
    });

    it('ignores overrides that fail schema validation', () => {
      expect(
        parseRateLimitConfig({
          RATE_LIMIT_TOOL_OVERRIDES: JSON.stringify({
            recall: { limit: -1, windowSeconds: 10 },
          }),
        }).toolOverrides,
      ).toEqual({});
    });
  });

  describe('isAuthRequired', () => {
    it('reflects the AUTH_REQUIRED flag', () => {
      expect(isAuthRequired({ AUTH_REQUIRED: 'true' })).toBe(true);
      expect(isAuthRequired({})).toBe(false);
    });
  });
});
