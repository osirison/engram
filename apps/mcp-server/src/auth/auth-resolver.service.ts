import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  JwtError,
  JwtRevocationService,
  JwtService,
  type AuthIdentity,
  type JwtClaims,
} from '@engram/auth';
import { ApiKeysService } from '../api-keys/api-keys.service';

export type AuthOutcome =
  | { status: 'anonymous' }
  | { status: 'authenticated'; identity: AuthIdentity }
  | { status: 'invalid'; reason: string };

/** Headers as exposed by Node's http/express request. */
export type RequestHeaders = Record<string, string | string[] | undefined>;

const API_KEY_PREFIX = 'eng_';

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Resolves the principal behind a request from its credentials, supporting:
 *   - `X-API-Key: eng_...` or `Authorization: Bearer eng_...` (programmatic)
 *   - `Authorization: Bearer <jwt>` (interactive session)
 *
 * Returns `anonymous` when no credential is presented, `invalid` when one is
 * presented but fails verification, and `authenticated` with the resolved
 * {@link AuthIdentity} otherwise. A presented-but-invalid credential is never
 * silently downgraded to anonymous.
 *
 * When a {@link JwtRevocationService} is wired (enterprise profile — requires
 * Redis), verified JWTs are additionally checked against the `jti` denylist so
 * logged-out tokens are rejected for their remaining lifetime.
 */
@Injectable()
export class AuthResolver {
  private readonly logger = new Logger(AuthResolver.name);

  constructor(
    private readonly apiKeys: ApiKeysService,
    @Optional() private readonly jwt?: JwtService,
    @Optional() private readonly revocation?: JwtRevocationService,
  ) {}

  async authenticate(headers: RequestHeaders): Promise<AuthOutcome> {
    const apiKeyHeader = firstHeader(headers['x-api-key']);
    const authHeader = firstHeader(headers['authorization']);

    let rawApiKey: string | undefined = apiKeyHeader?.trim() || undefined;
    let bearer: string | undefined;

    if (authHeader) {
      const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
      if (match?.[1]) {
        const token = match[1].trim();
        if (token.startsWith(API_KEY_PREFIX)) {
          rawApiKey ??= token;
        } else {
          bearer = token;
        }
      }
    }

    if (rawApiKey) {
      return this.authenticateApiKey(rawApiKey);
    }
    if (bearer) {
      return this.authenticateJwt(bearer);
    }
    return { status: 'anonymous' };
  }

  private async authenticateApiKey(rawKey: string): Promise<AuthOutcome> {
    let record: Awaited<ReturnType<ApiKeysService['verifyApiKey']>>;
    try {
      record = await this.apiKeys.verifyApiKey(rawKey);
    } catch (error) {
      this.logger.warn(`API key verification error: ${String(error)}`);
      return { status: 'invalid', reason: 'API key verification failed' };
    }
    if (!record) {
      return { status: 'invalid', reason: 'Invalid or revoked API key' };
    }
    return {
      status: 'authenticated',
      identity: {
        userId: record.userId,
        organizationId: record.organizationId ?? null,
        email: null,
        scopes: record.scopes,
        method: 'api-key',
        apiKeyId: record.id,
      },
    };
  }

  private async authenticateJwt(token: string): Promise<AuthOutcome> {
    if (!this.jwt) {
      return { status: 'invalid', reason: 'JWT auth is not configured' };
    }
    let claims: JwtClaims;
    try {
      claims = this.jwt.verify(token);
    } catch (error) {
      return {
        status: 'invalid',
        reason: error instanceof Error ? error.message : 'Invalid token',
      };
    }

    // Revocation (jti denylist) check — present only when Redis is wired
    // (enterprise). Fail-closed: a denylist store error rejects the token
    // rather than accepting a possibly-revoked one, matching the API-key
    // posture above where a verification error never authenticates.
    if (this.revocation) {
      try {
        await this.revocation.assertNotRevoked(claims.jti);
      } catch (error) {
        if (error instanceof JwtError) {
          return { status: 'invalid', reason: error.message };
        }
        this.logger.warn(`JWT revocation check error: ${String(error)}`);
        return { status: 'invalid', reason: 'Token revocation check failed' };
      }
    }

    return {
      status: 'authenticated',
      identity: {
        userId: claims.sub,
        organizationId: claims.org,
        email: claims.email,
        scopes: claims.scopes,
        method: 'jwt',
        apiKeyId: null,
      },
    };
  }
}
