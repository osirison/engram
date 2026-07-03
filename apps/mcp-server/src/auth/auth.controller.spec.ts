import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthController } from './auth.controller';

function build(
  overrides: {
    isEnabled?: (n: string) => boolean;
    consumeState?: () => unknown;
    exchange?: () => unknown;
    authenticate?: () => unknown;
    getSession?: () => unknown;
    verify?: () => unknown;
  } = {},
): {
  controller: AuthController;
  oauth: { isEnabled: jest.Mock; getProvider: jest.Mock };
  sessions: {
    createOAuthState: jest.Mock;
    consumeOAuthState: jest.Mock;
    createSession: jest.Mock;
    getSession: jest.Mock;
    destroySession: jest.Mock;
  };
  jwt: {
    issueWithClaims: jest.Mock;
    verify: jest.Mock;
    tokenLifetimeSeconds: number;
  };
  revocation: { revoke: jest.Mock };
  users: { upsertByEmail: jest.Mock };
  resolver: { authenticate: jest.Mock };
} {
  const oauth = {
    isEnabled: jest.fn(
      overrides.isEnabled ?? ((n: string): boolean => n === 'github'),
    ),
    getProvider: jest.fn(() => ({
      getAuthorizationUrl: jest.fn(() => 'https://github.test/auth?state=s'),
      exchangeCodeForProfile: jest.fn(
        overrides.exchange ??
          ((): Promise<{
            provider: string;
            providerAccountId: string;
            email: string;
            name: string;
          }> =>
            Promise.resolve({
              provider: 'github',
              providerAccountId: '1',
              email: 'octo@gh.com',
              name: 'Octo',
            })),
      ),
    })),
  };
  const sessions = {
    createOAuthState: jest.fn(() => Promise.resolve('state-1')),
    consumeOAuthState: jest.fn(
      overrides.consumeState ??
        ((): Promise<{ provider: string; createdAt: number }> =>
          Promise.resolve({ provider: 'github', createdAt: 1 })),
    ),
    createSession: jest.fn(() => Promise.resolve('sess-1')),
    getSession: jest.fn(
      overrides.getSession ??
        ((): Promise<unknown> =>
          Promise.resolve({
            userId: 'user-1',
            organizationId: null,
            email: 'octo@gh.com',
            scopes: [],
            createdAt: 100,
            jti: 'session-jti',
            jwtExp: 4100,
          })),
    ),
    destroySession: jest.fn(() => Promise.resolve(undefined)),
  };
  const jwt = {
    issueWithClaims: jest.fn(() => ({
      token: 'jwt-token',
      claims: { jti: 'minted-jti', exp: 3700, iat: 100, sub: 'user-1' },
    })),
    verify: jest.fn(
      overrides.verify ??
        ((): { jti: string; exp: number } => ({
          jti: 'bearer-jti',
          exp: 5000,
        })),
    ),
    tokenLifetimeSeconds: 3600,
  };
  const revocation = { revoke: jest.fn(() => Promise.resolve(true)) };
  const users = {
    upsertByEmail: jest.fn(() =>
      Promise.resolve({
        id: 'user-1',
        email: 'octo@gh.com',
        organizationId: null,
      }),
    ),
  };
  const resolver = {
    authenticate: jest.fn(
      overrides.authenticate ??
        ((): Promise<{
          status: string;
          identity: { userId: string; method: string };
        }> =>
          Promise.resolve({
            status: 'authenticated',
            identity: { userId: 'user-1', method: 'jwt' },
          })),
    ),
  };
  const controller = new AuthController(
    oauth as never,
    sessions as never,
    jwt as never,
    revocation as never,
    users as never,
    resolver as never,
    'https://api.example.com',
  );
  return { controller, oauth, sessions, jwt, revocation, users, resolver };
}

function mockRes(): Response {
  return {
    redirect: jest.fn(),
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response;
}

describe('AuthController', () => {
  describe('login', () => {
    it('redirects to the provider with a fresh state', async () => {
      const { controller, sessions } = build();
      const res = mockRes();
      await controller.login('github', res);
      expect(sessions.createOAuthState).toHaveBeenCalledWith('github');
      expect(res.redirect).toHaveBeenCalledWith(
        'https://github.test/auth?state=s',
      );
    });

    it('404s for a disabled provider', async () => {
      const { controller } = build({ isEnabled: () => false });
      await expect(
        controller.login('github', mockRes()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('callback', () => {
    it('exchanges the code, upserts the user, and issues a token + session', async () => {
      const { controller, users, sessions, jwt } = build();
      const res = mockRes();
      const result = (await controller.callback(
        'github',
        { code: 'c', state: 'state-1' },
        res,
      )) as { token: string; sessionId?: string };
      expect(sessions.consumeOAuthState).toHaveBeenCalledWith('state-1');
      expect(users.upsertByEmail).toHaveBeenCalledWith('octo@gh.com');
      expect(jwt.issueWithClaims).toHaveBeenCalled();
      expect(result.token).toBe('jwt-token');
      // The minted jti/exp are bound to the session for revocation on logout.
      expect(sessions.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ jti: 'minted-jti', jwtExp: 3700 }),
      );
      // The session id must NOT be echoed in the body — cookie only.
      expect(result.sessionId).toBeUndefined();
      expect(res.cookie).toHaveBeenCalledWith(
        'engram_session',
        'sess-1',
        expect.objectContaining({ httpOnly: true }),
      );
    });

    it('rejects an unknown/expired state', async () => {
      const { controller } = build({
        consumeState: () => Promise.resolve(null),
      });
      await expect(
        controller.callback('github', { code: 'c', state: 'x' }, mockRes()),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a state minted for a different provider', async () => {
      const { controller } = build({
        consumeState: () =>
          Promise.resolve({ provider: 'google', createdAt: 1 }),
      });
      await expect(
        controller.callback('github', { code: 'c', state: 's' }, mockRes()),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects missing code or state', async () => {
      const { controller } = build();
      await expect(
        controller.callback('github', { state: 's' }, mockRes()),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('maps an OAuth exchange failure to 401', async () => {
      const { controller } = build({
        exchange: () => {
          throw new Error('exchange failed');
        },
      });
      await expect(
        controller.callback('github', { code: 'c', state: 's' }, mockRes()),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('me / logout', () => {
    it('returns the resolved identity', async () => {
      const { controller } = build();
      const result = (await controller.me({ headers: {} } as never)) as {
        user: { userId: string };
      };
      expect(result.user.userId).toBe('user-1');
    });

    it('401s when unauthenticated', async () => {
      const { controller } = build({
        authenticate: () => Promise.resolve({ status: 'anonymous' }),
      });
      await expect(
        controller.me({ headers: {} } as never),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('destroys the session named by the cookie and clears it', async () => {
      const { controller, sessions } = build();
      const res = mockRes();
      await controller.logout(
        { headers: { cookie: 'foo=bar; engram_session=sess-1' } } as never,
        res,
      );
      expect(sessions.destroySession).toHaveBeenCalledWith('sess-1');
      expect(res.clearCookie).toHaveBeenCalledWith('engram_session');
    });

    it('revokes the jti paired with the session on logout', async () => {
      const { controller, revocation } = build();
      await controller.logout(
        { headers: { cookie: 'engram_session=sess-1' } } as never,
        mockRes(),
      );
      expect(revocation.revoke).toHaveBeenCalledWith({
        jti: 'session-jti',
        exp: 4100,
      });
    });

    it('falls back to createdAt + lifetime for legacy sessions without jwtExp', async () => {
      const { controller, revocation } = build({
        getSession: () =>
          Promise.resolve({
            userId: 'user-1',
            organizationId: null,
            email: null,
            scopes: [],
            createdAt: 100,
            jti: 'legacy-jti',
          }),
      });
      await controller.logout(
        { headers: { cookie: 'engram_session=sess-1' } } as never,
        mockRes(),
      );
      // exp = createdAt (100) + tokenLifetimeSeconds (3600)
      expect(revocation.revoke).toHaveBeenCalledWith({
        jti: 'legacy-jti',
        exp: 3700,
      });
    });

    it('revokes a Bearer JWT presented on the logout request', async () => {
      const { controller, jwt, revocation } = build({
        getSession: () => Promise.resolve(null),
      });
      await controller.logout(
        {
          headers: {
            cookie: 'engram_session=sess-1',
            authorization: 'Bearer some.jwt.token',
          },
        } as never,
        mockRes(),
      );
      expect(jwt.verify).toHaveBeenCalledWith('some.jwt.token');
      expect(revocation.revoke).toHaveBeenCalledWith({
        jti: 'bearer-jti',
        exp: 5000,
      });
    });

    it('revokes both the session jti and a distinct Bearer jti presented together', async () => {
      // Cookie names session-jti; the Authorization header carries a different
      // token (bearer-jti). Both must be denylisted — guards against a
      // regression that makes the Bearer branch an `else` of the session branch.
      const { controller, revocation } = build();
      await controller.logout(
        {
          headers: {
            cookie: 'engram_session=sess-1',
            authorization: 'Bearer some.jwt.token',
          },
        } as never,
        mockRes(),
      );
      expect(revocation.revoke).toHaveBeenCalledWith({
        jti: 'session-jti',
        exp: 4100,
      });
      expect(revocation.revoke).toHaveBeenCalledWith({
        jti: 'bearer-jti',
        exp: 5000,
      });
      expect(revocation.revoke).toHaveBeenCalledTimes(2);
    });

    it('propagates a denylist store error on the session path (no false 204)', async () => {
      // The logout contract: a 204 must never falsely promise revocation. When
      // the denylist write fails, the handler rejects (→ 500) rather than
      // resolving, and — because revoke precedes destroy/clear — the session is
      // left intact so the client retries rather than believing it logged out.
      const { controller, revocation, sessions } = build();
      revocation.revoke.mockRejectedValue(new Error('redis down'));
      const res = mockRes();
      await expect(
        controller.logout(
          { headers: { cookie: 'engram_session=sess-1' } } as never,
          res,
        ),
      ).rejects.toThrow('redis down');
      expect(sessions.destroySession).not.toHaveBeenCalled();
      expect(res.clearCookie).not.toHaveBeenCalled();
    });

    it('propagates a denylist store error on the Bearer path (no false 204)', async () => {
      const { controller, revocation } = build({
        getSession: () => Promise.resolve(null),
      });
      revocation.revoke.mockRejectedValue(new Error('redis down'));
      const res = mockRes();
      await expect(
        controller.logout(
          { headers: { authorization: 'Bearer some.jwt.token' } } as never,
          res,
        ),
      ).rejects.toThrow('redis down');
      expect(res.clearCookie).not.toHaveBeenCalled();
    });

    it('ignores an invalid Bearer token on logout (idempotent 204)', async () => {
      const { controller, revocation, sessions } = build({
        getSession: () => Promise.resolve(null),
        verify: () => {
          throw new Error('bad token');
        },
      });
      const res = mockRes();
      await controller.logout(
        {
          headers: {
            cookie: 'engram_session=sess-1',
            authorization: 'Bearer garbage',
          },
        } as never,
        res,
      );
      expect(revocation.revoke).not.toHaveBeenCalled();
      expect(sessions.destroySession).toHaveBeenCalledWith('sess-1');
      expect(res.clearCookie).toHaveBeenCalledWith('engram_session');
    });

    it('does not treat an eng_ API key Bearer as a JWT on logout', async () => {
      const { controller, jwt, revocation } = build({
        getSession: () => Promise.resolve(null),
      });
      await controller.logout(
        { headers: { authorization: 'Bearer eng_secretkey123' } } as never,
        mockRes(),
      );
      expect(jwt.verify).not.toHaveBeenCalled();
      expect(revocation.revoke).not.toHaveBeenCalled();
    });

    it('is a no-op destroy when no session cookie is present', async () => {
      const { controller, sessions, revocation } = build();
      const res = mockRes();
      await controller.logout({ headers: {} } as never, res);
      expect(sessions.destroySession).not.toHaveBeenCalled();
      expect(revocation.revoke).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalledWith('engram_session');
    });
  });
});
