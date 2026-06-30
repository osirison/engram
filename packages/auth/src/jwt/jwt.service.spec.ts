import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { JwtService, JwtError } from './jwt.service.js';

const SECRET = 'test-secret-must-be-at-least-32-characters-long';

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

describe('JwtService', () => {
  it('rejects a secret shorter than 32 characters', () => {
    expect(() => new JwtService({ secret: 'too-short' })).toThrow(/at least 32/);
  });

  it('issues and verifies a token, preserving claims', () => {
    const svc = new JwtService({ secret: SECRET });
    const token = svc.issue({
      userId: 'user-1',
      email: 'a@b.com',
      organizationId: 'org-9',
      scopes: ['memories:read', 'memories:write'],
    });
    const claims = svc.verify(token);
    expect(claims.sub).toBe('user-1');
    expect(claims.email).toBe('a@b.com');
    expect(claims.org).toBe('org-9');
    expect(claims.scopes).toEqual(['memories:read', 'memories:write']);
    expect(claims.iss).toBe('engram');
    expect(claims.exp).toBeGreaterThan(claims.iat);
    expect(claims.jti).toBeTruthy();
  });

  it('defaults optional claims to null/empty', () => {
    const svc = new JwtService({ secret: SECRET });
    const claims = svc.verify(svc.issue({ userId: 'user-2' }));
    expect(claims.email).toBeNull();
    expect(claims.org).toBeNull();
    expect(claims.scopes).toEqual([]);
  });

  it('rejects an expired token', () => {
    const svc = new JwtService({ secret: SECRET, expiresInSeconds: 100 });
    const issuedAt = 1_000_000;
    const token = svc.issue({ userId: 'user-1' }, issuedAt);
    // verify "now" past expiry
    expect(() => svc.verify(token, issuedAt + 101)).toThrowError(
      expect.objectContaining({ code: 'expired' })
    );
    // still valid just before expiry
    expect(svc.verify(token, issuedAt + 99).sub).toBe('user-1');
  });

  it('rejects a token issued by a different secret', () => {
    const a = new JwtService({ secret: SECRET });
    const b = new JwtService({ secret: 'another-secret-also-32-chars-minimum-xx' });
    const token = a.issue({ userId: 'user-1' });
    expect(() => b.verify(token)).toThrowError(expect.objectContaining({ code: 'signature' }));
  });

  it('rejects a token with a tampered payload', () => {
    const svc = new JwtService({ secret: SECRET });
    const token = svc.issue({ userId: 'user-1', scopes: ['memories:read'] });
    const [header, payload, signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    decoded.scopes = ['admin'];
    decoded.sub = 'victim';
    const forged = `${header}.${b64url(JSON.stringify(decoded))}.${signature}`;
    expect(() => svc.verify(forged)).toThrowError(expect.objectContaining({ code: 'signature' }));
  });

  it('rejects alg-confusion: "none" tokens', () => {
    const svc = new JwtService({ secret: SECRET });
    const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const payload = b64url(
      JSON.stringify({
        sub: 'attacker',
        email: null,
        org: null,
        scopes: ['admin'],
        iss: 'engram',
        iat: 1,
        exp: 9_999_999_999,
        jti: 'x',
      })
    );
    // none token with empty signature
    expect(() => svc.verify(`${header}.${payload}.`)).toThrow(JwtError);
    // none token with no signature segment
    expect(() => svc.verify(`${header}.${payload}`)).toThrow(JwtError);
  });

  it('rejects a token whose header lies about the algorithm', () => {
    const svc = new JwtService({ secret: SECRET });
    // Attacker forges header alg=HS512 but signs the HMAC-SHA256 we would accept.
    const header = b64url(JSON.stringify({ alg: 'HS512', typ: 'JWT' }));
    const payload = b64url(
      JSON.stringify({
        sub: 'attacker',
        email: null,
        org: null,
        scopes: [],
        iss: 'engram',
        iat: 1,
        exp: 9_999_999_999,
        jti: 'x',
      })
    );
    const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
    expect(() => svc.verify(`${header}.${payload}.${sig}`)).toThrowError(
      expect.objectContaining({ code: 'malformed' })
    );
  });

  it('rejects a token with an unexpected issuer', () => {
    const a = new JwtService({ secret: SECRET, issuer: 'evil' });
    const b = new JwtService({ secret: SECRET, issuer: 'engram' });
    const token = a.issue({ userId: 'user-1' });
    expect(() => b.verify(token)).toThrowError(expect.objectContaining({ code: 'issuer' }));
  });

  it('rejects malformed tokens', () => {
    const svc = new JwtService({ secret: SECRET });
    expect(() => svc.verify('')).toThrow(JwtError);
    expect(() => svc.verify('a.b')).toThrow(JwtError);
    expect(() => svc.verify('not-base64!.b.c')).toThrow(JwtError);
  });

  it('rejects a token issued in the future beyond clock skew', () => {
    const svc = new JwtService({ secret: SECRET });
    const future = 2_000_000;
    const token = svc.issue({ userId: 'user-1' }, future);
    expect(() => svc.verify(token, future - 3_600)).toThrowError(
      expect.objectContaining({ code: 'not-active' })
    );
  });
});
