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
  } = {},
): {
  controller: AuthController;
  oauth: { isEnabled: jest.Mock; getProvider: jest.Mock };
  sessions: {
    createOAuthState: jest.Mock;
    consumeOAuthState: jest.Mock;
    createSession: jest.Mock;
    destroySession: jest.Mock;
  };
  jwt: { issue: jest.Mock; tokenLifetimeSeconds: number };
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
    destroySession: jest.fn(() => Promise.resolve(undefined)),
  };
  const jwt = { issue: jest.fn(() => 'jwt-token'), tokenLifetimeSeconds: 3600 };
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
    users as never,
    resolver as never,
    'https://api.example.com',
  );
  return { controller, oauth, sessions, jwt, users, resolver };
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
      expect(jwt.issue).toHaveBeenCalled();
      expect(result.token).toBe('jwt-token');
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

    it('is a no-op destroy when no session cookie is present', async () => {
      const { controller, sessions } = build();
      const res = mockRes();
      await controller.logout({ headers: {} } as never, res);
      expect(sessions.destroySession).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalledWith('engram_session');
    });
  });
});
