/**
 * Parses ENGRAM auth/rate-limit configuration from the environment into the
 * structured options the `@engram/auth` services expect. Reads `process.env`
 * directly (consistent with the rest of the app) — values are already
 * validated at boot by `@engram/config`'s `validateEnv`.
 */
import { z } from 'zod';
import {
  FetchOAuthHttpClient,
  GitHubOAuthProvider,
  GoogleOAuthProvider,
  type OAuthProvider,
  type RateLimitRule,
} from '@engram/auth';

type Env = NodeJS.ProcessEnv;

const DEFAULT_JWT_TTL_SECONDS = 7 * 24 * 60 * 60;

const TRUTHY = new Set(['true', '1', 'yes', 'on']);
export function isFlagEnabled(value: string | undefined): boolean {
  return value != null && TRUTHY.has(value.trim().toLowerCase());
}

/**
 * Convert a duration string (`7d`, `24h`, `30m`, `3600s`) or a plain number of
 * seconds to seconds. Falls back to 7 days for unrecognised input.
 */
export function parseDurationToSeconds(
  value: string | undefined,
  fallback = DEFAULT_JWT_TTL_SECONDS,
): number {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  const match = /^(\d+)\s*([smhd])$/i.exec(trimmed);
  if (!match || !match[1] || !match[2]) return fallback;
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multiplier =
    unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86_400;
  return amount * multiplier;
}

export interface JwtConfig {
  secret: string;
  expiresInSeconds: number;
}

/** Returns JWT config, or null when no `JWT_SECRET` is configured. */
export function parseJwtConfig(env: Env = process.env): JwtConfig | null {
  const secret = env.JWT_SECRET;
  if (!secret || secret.length < 32) return null;
  return {
    secret,
    expiresInSeconds: parseDurationToSeconds(env.JWT_EXPIRES_IN),
  };
}

/** Base URL used to build OAuth callback URLs. Defaults to localhost:PORT. */
export function oauthRedirectBaseUrl(env: Env = process.env): string {
  return (
    env.OAUTH_REDIRECT_BASE_URL ?? `http://localhost:${env.PORT ?? '3000'}`
  ).replace(/\/+$/, '');
}

/** Instantiate the OAuth providers whose credentials are configured. */
export function buildOAuthProviders(env: Env = process.env): OAuthProvider[] {
  const http = new FetchOAuthHttpClient();
  const providers: OAuthProvider[] = [];
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    providers.push(
      new GitHubOAuthProvider(
        {
          clientId: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
        },
        http,
      ),
    );
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push(
      new GoogleOAuthProvider(
        {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
        http,
      ),
    );
  }
  return providers;
}

export interface RateLimitConfig {
  enabled: boolean;
  windowSeconds: number;
  userRpm: number;
  orgRpm: number;
  ipRpm: number;
  toolOverrides: Record<string, RateLimitRule>;
}

const ruleSchema = z
  .object({
    limit: z.number().int().positive(),
    windowSeconds: z.number().int().positive(),
  })
  .strict();
const overridesSchema = z.record(z.string(), ruleSchema);

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Parse rate-limit configuration; invalid tool overrides are ignored. */
export function parseRateLimitConfig(env: Env = process.env): RateLimitConfig {
  let toolOverrides: Record<string, RateLimitRule> = {};
  if (env.RATE_LIMIT_TOOL_OVERRIDES) {
    try {
      const parsed = overridesSchema.safeParse(
        JSON.parse(env.RATE_LIMIT_TOOL_OVERRIDES),
      );
      if (parsed.success) toolOverrides = parsed.data;
    } catch {
      // Malformed JSON → no overrides (already validated at boot if present).
    }
  }
  return {
    enabled: isFlagEnabled(env.RATE_LIMIT_ENABLED),
    windowSeconds: positiveInt(env.RATE_LIMIT_WINDOW_SEC, 60),
    userRpm: positiveInt(env.RATE_LIMIT_USER_RPM, 120),
    orgRpm: positiveInt(env.RATE_LIMIT_ORG_RPM, 6000),
    ipRpm: positiveInt(env.RATE_LIMIT_IP_RPM, 60),
    toolOverrides,
  };
}

export function isAuthRequired(env: Env = process.env): boolean {
  return isFlagEnabled(env.AUTH_REQUIRED);
}
