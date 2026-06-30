import type { Request, Response } from 'express';
import {
  McpAuthMiddleware,
  toolCallNames,
  type AuthedRequest,
} from './mcp-auth.middleware';
import type { AuthResolver, AuthOutcome } from './auth-resolver.service';

function mockRes(): Response & {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
} {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    headersSent: false,
  };
  const r = res as unknown as Response & typeof res;
  r.status = jest.fn((code: number) => {
    res.statusCode = code;
    return r;
  }) as never;
  r.json = jest.fn((b: unknown) => {
    res.body = b;
    res.headersSent = true;
    return r;
  }) as never;
  r.set = jest.fn((k: string, v: string) => {
    res.headers[k] = v;
    return r;
  }) as never;
  return r as never;
}

function resolverReturning(outcome: AuthOutcome): AuthResolver {
  return {
    authenticate: jest.fn(() => Promise.resolve(outcome)),
  } as unknown as AuthResolver;
}

const identityOutcome: AuthOutcome = {
  status: 'authenticated',
  identity: {
    userId: 'user-9',
    organizationId: 'org-9',
    email: 'a@b.com',
    scopes: ['memories:read'],
    method: 'jwt',
    apiKeyId: null,
  },
};

describe('toolCallNames', () => {
  it('extracts a single tools/call name', () => {
    expect(
      toolCallNames({ method: 'tools/call', params: { name: 'recall' } }),
    ).toEqual(['recall']);
  });
  it('extracts names from a batch', () => {
    expect(
      toolCallNames([
        { method: 'tools/call', params: { name: 'a' } },
        { method: 'initialize' },
        { method: 'tools/call', params: { name: 'b' } },
      ]),
    ).toEqual(['a', 'b']);
  });
  it('ignores non tools/call bodies', () => {
    expect(toolCallNames({ method: 'tools/list' })).toEqual([]);
    expect(toolCallNames(undefined)).toEqual([]);
  });
});

describe('McpAuthMiddleware', () => {
  const callBody = (
    name: string,
  ): { method: string; params: { name: string } } => ({
    method: 'tools/call',
    params: { name },
  });

  it('attaches req.auth when authenticated', async () => {
    const mw = new McpAuthMiddleware(resolverReturning(identityOutcome), false);
    const req = { headers: {}, body: callBody('recall') } as Request;
    const res = mockRes();
    const next = jest.fn();
    await mw.handle(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((req as AuthedRequest).auth?.extra.userId).toBe('user-9');
  });

  it('rejects a presented-but-invalid credential with 401', async () => {
    const mw = new McpAuthMiddleware(
      resolverReturning({ status: 'invalid', reason: 'bad' }),
      false,
    );
    const res = mockRes();
    const next = jest.fn();
    await mw.handle(
      { headers: {}, body: callBody('recall') } as Request,
      res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('rejects protected tool calls when auth is required and absent', async () => {
    const mw = new McpAuthMiddleware(
      resolverReturning({ status: 'anonymous' }),
      true,
    );
    const res = mockRes();
    const next = jest.fn();
    await mw.handle(
      { headers: {}, body: callBody('recall') } as Request,
      res,
      next,
    );
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows public tools without auth even when required', async () => {
    const mw = new McpAuthMiddleware(
      resolverReturning({ status: 'anonymous' }),
      true,
    );
    const res = mockRes();
    const next = jest.fn();
    await mw.handle(
      { headers: {}, body: callBody('ping') } as Request,
      res,
      next,
    );
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('passes through anonymous requests when auth is not required', async () => {
    const mw = new McpAuthMiddleware(
      resolverReturning({ status: 'anonymous' }),
      false,
    );
    const res = mockRes();
    const next = jest.fn();
    await mw.handle(
      { headers: {}, body: callBody('recall') } as Request,
      res,
      next,
    );
    expect(next).toHaveBeenCalled();
  });
});
