/**
 * Wiring-level test for JWT revocation on logout (#202).
 *
 * Exercises the real seams — AuthController → SessionService/JwtService/
 * JwtRevocationService → AuthResolver → McpAuthMiddleware — over an in-memory
 * store standing in for Redis. Proves the end-to-end property the security
 * review demanded: after `POST /auth/logout`, the Bearer JWT issued at login
 * is rejected by the MCP request pipeline (and `/auth/me`) even though its
 * signature and expiry are still valid.
 */
import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  JwtRevocationService,
  JwtService,
  SessionService,
  type OAuthService,
  type SessionStore,
} from '@engram/auth';
import { AuthController } from './auth.controller';
import { AuthResolver } from './auth-resolver.service';
import { McpAuthMiddleware } from './mcp-auth.middleware';
import type { ApiKeysService } from '../api-keys/api-keys.service';
import type { UserService } from './user.service';

const SECRET = 'wiring-test-secret-at-least-32-characters-long';

/** In-memory SessionStore doubling as the jti denylist store. */
class FakeStore implements SessionStore {
  public map = new Map<string, string>();
  set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
    return Promise.resolve();
  }
  get(key: string): Promise<string | null> {
    return Promise.resolve(this.map.get(key) ?? null);
  }
  delete(key: string): Promise<void> {
    this.map.delete(key);
    return Promise.resolve();
  }
  getDelete(key: string): Promise<string | null> {
    const v = this.map.get(key) ?? null;
    this.map.delete(key);
    return Promise.resolve(v);
  }
}

function fakeOAuth(): OAuthService {
  return {
    isEnabled: (name: string) => name === 'github',
    getProvider: () => ({
      getAuthorizationUrl: () => 'https://github.test/authorize',
      exchangeCodeForProfile: () =>
        Promise.resolve({
          provider: 'github' as const,
          providerAccountId: '1',
          email: 'octo@gh.com',
          name: 'Octo',
        }),
    }),
  } as unknown as OAuthService;
}

function fakeUsers(): UserService {
  // Distinct id per login so the "other users" test genuinely spans two users,
  // not one user twice. First login → user-1 (relied on by single-login tests).
  let n = 0;
  return {
    upsertByEmail: jest.fn(() => {
      n += 1;
      return Promise.resolve({
        id: `user-${n}`,
        email: 'octo@gh.com',
        organizationId: null,
      });
    }),
  } as unknown as UserService;
}

function mockControllerRes(): Response & { cookies: Map<string, string> } {
  const cookies = new Map<string, string>();
  return {
    cookies,
    cookie: jest.fn((name: string, value: string) => {
      cookies.set(name, value);
    }),
    clearCookie: jest.fn((name: string) => {
      cookies.delete(name);
    }),
    redirect: jest.fn(),
  } as unknown as Response & { cookies: Map<string, string> };
}

function mockMwRes(): Response & { statusCode: number; body: unknown } {
  const res = { statusCode: 200, body: undefined as unknown };
  const r = res as unknown as Response & typeof res;
  r.status = jest.fn((code: number) => {
    res.statusCode = code;
    return r;
  }) as never;
  r.json = jest.fn((b: unknown) => {
    res.body = b;
    return r;
  }) as never;
  r.set = jest.fn(() => r) as never;
  return r as never;
}

function mcpRequest(token: string): Request {
  return {
    headers: { authorization: `Bearer ${token}` },
    body: { method: 'tools/call', params: { name: 'recall' } },
  } as unknown as Request;
}

interface Harness {
  controller: AuthController;
  middleware: McpAuthMiddleware;
  sessions: SessionService;
  revocation: JwtRevocationService;
  store: FakeStore;
  login(): Promise<{ token: string; sessionId: string }>;
}

function buildHarness(): Harness {
  const store = new FakeStore();
  const jwt = new JwtService({ secret: SECRET });
  const sessions = new SessionService(store);
  const revocation = new JwtRevocationService(store);
  const apiKeys = {
    verifyApiKey: jest.fn(() => Promise.resolve(null)),
  } as unknown as ApiKeysService;
  const resolver = new AuthResolver(apiKeys, jwt, revocation);
  const middleware = new McpAuthMiddleware(resolver, true);
  const controller = new AuthController(
    fakeOAuth(),
    sessions,
    jwt,
    revocation,
    fakeUsers(),
    resolver,
    'https://api.example.com',
  );

  const login = async (): Promise<{ token: string; sessionId: string }> => {
    const state = await sessions.createOAuthState('github');
    const res = mockControllerRes();
    const result = (await controller.callback(
      'github',
      { code: 'code-1', state },
      res,
    )) as { token: string };
    return {
      token: result.token,
      sessionId: res.cookies.get('engram_session')!,
    };
  };

  return { controller, middleware, sessions, revocation, store, login };
}

describe('JWT logout revocation (wiring)', () => {
  it('rejects a logged-out Bearer token at the MCP middleware (cookie-only logout)', async () => {
    const h = buildHarness();
    const { token, sessionId } = await h.login();
    expect(sessionId).toBeTruthy();

    // Before logout: the token authenticates a protected tools/call.
    const okRes = mockMwRes();
    const okNext = jest.fn();
    await h.middleware.handle(mcpRequest(token), okRes, okNext);
    expect(okNext).toHaveBeenCalled();
    expect(okRes.statusCode).toBe(200);

    // Logout presenting only the httpOnly session cookie — no Bearer header.
    await h.controller.logout(
      { headers: { cookie: `engram_session=${sessionId}` } } as never,
      mockControllerRes(),
    );

    // After logout: the very same Bearer token is rejected with 401.
    const deniedRes = mockMwRes();
    const deniedNext = jest.fn();
    await h.middleware.handle(mcpRequest(token), deniedRes, deniedNext);
    expect(deniedNext).not.toHaveBeenCalled();
    expect(deniedRes.statusCode).toBe(401);
    expect(JSON.stringify(deniedRes.body)).toContain('revoked');

    // And the session itself is gone.
    expect(await h.sessions.getSession(sessionId)).toBeNull();
  });

  it('rejects a logged-out Bearer token when logout presented only the token', async () => {
    const h = buildHarness();
    const { token } = await h.login();

    await h.controller.logout(
      { headers: { authorization: `Bearer ${token}` } } as never,
      mockControllerRes(),
    );

    const res = mockMwRes();
    const next = jest.fn();
    await h.middleware.handle(mcpRequest(token), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('rejects a logged-out token on /auth/me as well', async () => {
    const h = buildHarness();
    const { token, sessionId } = await h.login();

    const me = (await h.controller.me({
      headers: { authorization: `Bearer ${token}` },
    } as never)) as { user: { userId: string } };
    expect(me.user.userId).toBe('user-1');

    await h.controller.logout(
      { headers: { cookie: `engram_session=${sessionId}` } } as never,
      mockControllerRes(),
    );

    await expect(
      h.controller.me({
        headers: { authorization: `Bearer ${token}` },
      } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("leaves other users' tokens valid after one user logs out", async () => {
    const h = buildHarness();
    const first = await h.login();
    const second = await h.login();

    await h.controller.logout(
      { headers: { cookie: `engram_session=${first.sessionId}` } } as never,
      mockControllerRes(),
    );

    // First token dead, second still fine (revocation is per-jti, not global).
    const deadRes = mockMwRes();
    await h.middleware.handle(mcpRequest(first.token), deadRes, jest.fn());
    expect(deadRes.statusCode).toBe(401);

    const aliveRes = mockMwRes();
    const aliveNext = jest.fn();
    await h.middleware.handle(mcpRequest(second.token), aliveRes, aliveNext);
    expect(aliveNext).toHaveBeenCalled();
    expect(aliveRes.statusCode).toBe(200);
  });

  it('logout is idempotent — repeating it keeps the token revoked', async () => {
    const h = buildHarness();
    const { token, sessionId } = await h.login();
    const logoutReq = {
      headers: {
        cookie: `engram_session=${sessionId}`,
        authorization: `Bearer ${token}`,
      },
    } as never;

    await h.controller.logout(logoutReq, mockControllerRes());
    await h.controller.logout(logoutReq, mockControllerRes());

    const res = mockMwRes();
    await h.middleware.handle(mcpRequest(token), res, jest.fn());
    expect(res.statusCode).toBe(401);
  });
});
