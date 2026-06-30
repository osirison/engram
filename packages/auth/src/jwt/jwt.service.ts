/**
 * HS256 JSON Web Token issuer/verifier.
 *
 * Deliberately hand-rolled on `node:crypto` rather than pulling in `jose`:
 *   - `jose@6` is ESM-only (no `require` export), while this package emits
 *     CommonJS — `require('jose')` would rely on fragile Node ESM-in-CJS interop.
 *   - It matches the existing house style (API-key hashing already uses
 *     `node:crypto` directly).
 *   - It is *structurally* immune to algorithm-confusion attacks: verification
 *     never reads the algorithm from the (attacker-controlled) token to choose a
 *     strategy. We always compute an HMAC-SHA256 and compare in constant time,
 *     and additionally require the header to declare `alg: "HS256"`. There is no
 *     code path that honours `none`, `RS256`, or any asymmetric algorithm.
 */

import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { z } from 'zod';

const ALG = 'HS256';
const TOKEN_TYPE = 'JWT';
const MIN_SECRET_LENGTH = 32;
const DEFAULT_EXPIRES_SECONDS = 7 * 24 * 60 * 60; // 7 days
const DEFAULT_ISSUER = 'engram';

/** Reasons a token can fail verification. */
export type JwtErrorCode =
  | 'malformed'
  | 'signature'
  | 'expired'
  | 'not-active'
  | 'issuer'
  | 'claims';

/** Typed error thrown by {@link JwtService.verify}. */
export class JwtError extends Error {
  constructor(
    public readonly code: JwtErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'JwtError';
  }
}

export interface JwtServiceOptions {
  /** HMAC secret. Must be at least 32 characters. */
  secret: string;
  /** Token lifetime in seconds. Defaults to 7 days. */
  expiresInSeconds?: number;
  /** Expected `iss` claim. Defaults to `"engram"`. */
  issuer?: string;
}

export interface JwtIssueInput {
  userId: string;
  email?: string | null;
  organizationId?: string | null;
  scopes?: string[];
}

/** Verified, validated JWT claims. */
export interface JwtClaims {
  /** Subject — the ENGRAM user id (tenant). */
  sub: string;
  email: string | null;
  /** Organization id, when the user acts within an org. */
  org: string | null;
  scopes: string[];
  iss: string;
  /** Issued-at (seconds since epoch). */
  iat: number;
  /** Expiry (seconds since epoch). */
  exp: number;
  /** Unique token id (jti) — enables future revocation lists. */
  jti: string;
}

const claimsSchema = z
  .object({
    sub: z.string().min(1),
    email: z.string().nullable(),
    org: z.string().nullable(),
    scopes: z.array(z.string()),
    iss: z.string().min(1),
    iat: z.number().int(),
    exp: z.number().int(),
    jti: z.string().min(1),
  })
  .strip();

function base64urlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export class JwtService {
  private readonly secret: string;
  private readonly expiresInSeconds: number;
  private readonly issuer: string;

  constructor(options: JwtServiceOptions) {
    if (typeof options.secret !== 'string' || options.secret.length < MIN_SECRET_LENGTH) {
      throw new Error(`JWT secret must be at least ${MIN_SECRET_LENGTH} characters`);
    }
    this.secret = options.secret;
    this.expiresInSeconds = options.expiresInSeconds ?? DEFAULT_EXPIRES_SECONDS;
    this.issuer = options.issuer ?? DEFAULT_ISSUER;
  }

  /** Lifetime of issued tokens, in seconds. */
  get tokenLifetimeSeconds(): number {
    return this.expiresInSeconds;
  }

  private sign(signingInput: string): string {
    return createHmac('sha256', this.secret).update(signingInput).digest('base64url');
  }

  /** Issue a signed token for the given principal. */
  issue(input: JwtIssueInput, issuedAt: number = nowSeconds()): string {
    const header = { alg: ALG, typ: TOKEN_TYPE };
    const claims: JwtClaims = {
      sub: input.userId,
      email: input.email ?? null,
      org: input.organizationId ?? null,
      scopes: input.scopes ?? [],
      iss: this.issuer,
      iat: issuedAt,
      exp: issuedAt + this.expiresInSeconds,
      jti: randomUUID(),
    };
    const headerPart = base64urlEncode(JSON.stringify(header));
    const payloadPart = base64urlEncode(JSON.stringify(claims));
    const signingInput = `${headerPart}.${payloadPart}`;
    const signature = this.sign(signingInput);
    return `${signingInput}.${signature}`;
  }

  /**
   * Verify a token and return its claims, or throw {@link JwtError}.
   *
   * Validation order is signature → structure → issuer → expiry so that a
   * tampered token never reaches claim parsing.
   */
  verify(token: string, atSeconds: number = nowSeconds()): JwtClaims {
    if (typeof token !== 'string' || token.length === 0) {
      throw new JwtError('malformed', 'Empty token');
    }
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new JwtError('malformed', 'Token must have three segments');
    }
    const [headerPart, payloadPart, signaturePart] = parts;
    if (!headerPart || !payloadPart || !signaturePart) {
      throw new JwtError('malformed', 'Token has empty segments');
    }

    // Require a declared HS256 header. We never *choose* the algorithm from the
    // token — this check only rejects obviously wrong tokens early; the
    // constant-time HMAC comparison below is the real guarantee.
    let header: unknown;
    try {
      header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
    } catch {
      throw new JwtError('malformed', 'Unparseable header');
    }
    if (!isRecord(header) || header.alg !== ALG || header.typ !== TOKEN_TYPE) {
      throw new JwtError('malformed', 'Unsupported token header');
    }

    // Constant-time signature comparison.
    const expectedSignature = this.sign(`${headerPart}.${payloadPart}`);
    const provided = Buffer.from(signaturePart);
    const expected = Buffer.from(expectedSignature);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new JwtError('signature', 'Invalid signature');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    } catch {
      throw new JwtError('malformed', 'Unparseable payload');
    }

    const parsed = claimsSchema.safeParse(payload);
    if (!parsed.success) {
      throw new JwtError('claims', 'Invalid token claims');
    }
    const claims = parsed.data;

    if (claims.iss !== this.issuer) {
      throw new JwtError('issuer', 'Unexpected token issuer');
    }
    if (atSeconds >= claims.exp) {
      throw new JwtError('expired', 'Token has expired');
    }
    if (claims.iat > atSeconds + 60) {
      // Reject tokens issued in the future (allow 60s clock skew).
      throw new JwtError('not-active', 'Token issued in the future');
    }

    return claims;
  }
}
