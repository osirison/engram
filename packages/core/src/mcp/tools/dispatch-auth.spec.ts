/**
 * Auth-aware tool dispatch tests: identity injection, admin pass-through,
 * delegated (admin-scope) userId pass-through, required-auth enforcement, and
 * scope enforcement.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerTools, resolveActingUserId, type AuthPolicy, type Tool } from './index';

type CallRequest = {
  method: string;
  params: { name: string; arguments?: unknown };
};
type CallExtra = {
  authInfo?: { scopes?: string[]; extra?: Record<string, unknown> };
};
type CallResult = { content: Array<{ text: string }>; isError?: boolean };
type CallHandler = (request: CallRequest, extra?: CallExtra) => Promise<CallResult>;

const getRequestMethod = (schema: unknown): string | undefined =>
  (
    schema as {
      def?: { shape?: { method?: { def?: { values?: string[] } } } };
    }
  )?.def?.shape?.method?.def?.values?.[0];

const identityTool: Tool = {
  name: 'echo_user',
  description: 'echoes the acting userId',
  inputSchema: z.object({ userId: z.string() }).strict(),
  // Opts into delegation, so an admin-scoped principal may target another tenant.
  delegable: true,
  handler: (input): Promise<unknown> =>
    Promise.resolve({ echoedUserId: (input as { userId: string }).userId }),
};

// Identity tool that does NOT opt into delegation: every caller, admin included,
// is pinned to the verified tenant (the default posture for identity tools).
const pinnedTool: Tool = {
  name: 'pinned_echo',
  description: 'echoes the acting userId but is not delegable',
  inputSchema: z.object({ userId: z.string() }).strict(),
  handler: (input): Promise<unknown> =>
    Promise.resolve({ echoedUserId: (input as { userId: string }).userId }),
};

const adminTool: Tool = {
  name: 'admin_op',
  description: 'targets an arbitrary userId',
  inputSchema: z.object({ userId: z.string() }).strict(),
  handler: (input): Promise<unknown> =>
    Promise.resolve({ targetUserId: (input as { userId: string }).userId }),
  auth: 'admin',
};

const scopedTool: Tool = {
  name: 'write_thing',
  description: 'requires the memories:write scope',
  inputSchema: z.object({ userId: z.string() }).strict(),
  requiredScope: 'memories:write',
  // Delegable so we can prove delegation composes with scope enforcement.
  delegable: true,
  handler: (input): Promise<unknown> =>
    Promise.resolve({ ok: (input as { userId: string }).userId }),
};

describe('auth-aware tool dispatch', () => {
  let server: Server;

  beforeEach((): void => {
    server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } });
  });

  const capture = (tools: Tool[], policy: AuthPolicy): CallHandler => {
    let handler: CallHandler | undefined;
    vi.spyOn(server, 'setRequestHandler').mockImplementation((schema, fn): void => {
      if (getRequestMethod(schema) === 'tools/call') {
        handler = fn as unknown as CallHandler;
      }
    });
    registerTools(server, tools, policy);
    if (!handler) throw new Error('call handler not registered');
    return handler;
  };

  const parse = (result: CallResult): Record<string, unknown> =>
    JSON.parse(result.content[0]!.text) as Record<string, unknown>;

  it('injects the authenticated userId into identity tools, overriding input', async () => {
    const handler = capture([identityTool], { required: true });
    const result = await handler(
      { method: 'tools/call', params: { name: 'echo_user', arguments: { userId: 'attacker' } } },
      { authInfo: { extra: { userId: 'real-user' } } }
    );
    expect(parse(result).echoedUserId).toBe('real-user');
  });

  it('does NOT override userId for admin tools', async () => {
    const handler = capture([adminTool], { required: true });
    const result = await handler(
      { method: 'tools/call', params: { name: 'admin_op', arguments: { userId: 'target' } } },
      { authInfo: { extra: { userId: 'operator' } } }
    );
    expect(parse(result).targetUserId).toBe('target');
  });

  it('rejects protected tools when auth is required and absent', async () => {
    const handler = capture([identityTool], { required: true });
    const result = await handler({
      method: 'tools/call',
      params: { name: 'echo_user', arguments: { userId: 'x' } },
    });
    expect(result).toHaveProperty('isError', true);
    expect(parse(result).error).toContain('Unauthorized');
  });

  it('allows public tools without auth even when required', async () => {
    const handler = capture([], { required: true });
    const result = await handler({
      method: 'tools/call',
      params: { name: 'ping', arguments: {} },
    });
    expect(parse(result).status).toBe('pong');
  });

  it('uses input userId untouched when no identity is present and auth is optional', async () => {
    const handler = capture([identityTool], { required: false });
    const result = await handler({
      method: 'tools/call',
      params: { name: 'echo_user', arguments: { userId: 'self-declared' } },
    });
    expect(parse(result).echoedUserId).toBe('self-declared');
  });

  it('rejects a tool when the identity lacks the required scope', async () => {
    const handler = capture([scopedTool], { required: true });
    const result = await handler(
      { method: 'tools/call', params: { name: 'write_thing', arguments: {} } },
      { authInfo: { scopes: ['memories:read'], extra: { userId: 'u' } } }
    );
    expect(result).toHaveProperty('isError', true);
    expect(parse(result).error).toContain('scope');
  });

  it('allows a tool when the identity holds the required scope', async () => {
    const handler = capture([scopedTool], { required: true });
    const result = await handler(
      { method: 'tools/call', params: { name: 'write_thing', arguments: {} } },
      { authInfo: { scopes: ['memories:write'], extra: { userId: 'u' } } }
    );
    expect(parse(result).ok).toBe('u');
  });

  it('treats the admin scope as a universal grant', async () => {
    const handler = capture([scopedTool], { required: true });
    const result = await handler(
      { method: 'tools/call', params: { name: 'write_thing', arguments: {} } },
      { authInfo: { scopes: ['admin'], extra: { userId: 'u' } } }
    );
    expect(parse(result).ok).toBe('u');
  });

  describe('delegated (admin-scope) userId pass-through on identity tools', () => {
    it('honours an explicit foreign userId from an admin-scoped principal', async () => {
      const handler = capture([identityTool], { required: true });
      const result = await handler(
        {
          method: 'tools/call',
          params: { name: 'echo_user', arguments: { userId: 'other-tenant' } },
        },
        { authInfo: { scopes: ['admin'], extra: { userId: 'service-key-tenant' } } }
      );
      expect(parse(result).echoedUserId).toBe('other-tenant');
    });

    it('still overwrites a foreign userId supplied by a NON-admin principal', async () => {
      const handler = capture([identityTool], { required: true });
      const result = await handler(
        {
          method: 'tools/call',
          params: { name: 'echo_user', arguments: { userId: 'other-tenant' } },
        },
        {
          authInfo: {
            scopes: ['memories:read', 'memories:write', 'memories:delete'],
            extra: { userId: 'service-key-tenant' },
          },
        }
      );
      expect(parse(result).echoedUserId).toBe('service-key-tenant');
    });

    it('falls back to the admin principal’s own tenant when no userId is supplied', async () => {
      const handler = capture([identityTool], { required: true });
      const result = await handler(
        { method: 'tools/call', params: { name: 'echo_user', arguments: {} } },
        { authInfo: { scopes: ['admin'], extra: { userId: 'service-key-tenant' } } }
      );
      expect(parse(result).echoedUserId).toBe('service-key-tenant');
    });

    it('delegation also applies to scoped identity tools when admin satisfies the scope', async () => {
      const handler = capture([scopedTool], { required: true });
      const result = await handler(
        {
          method: 'tools/call',
          params: { name: 'write_thing', arguments: { userId: 'other-tenant' } },
        },
        { authInfo: { scopes: ['admin'], extra: { userId: 'service-key-tenant' } } }
      );
      expect(parse(result).ok).toBe('other-tenant');
    });

    it('pins an admin foreign userId on an identity tool that is NOT delegable', async () => {
      const handler = capture([pinnedTool], { required: true });
      const result = await handler(
        {
          method: 'tools/call',
          params: { name: 'pinned_echo', arguments: { userId: 'other-tenant' } },
        },
        { authInfo: { scopes: ['admin'], extra: { userId: 'service-key-tenant' } } }
      );
      // Delegation is opt-in per tool; without `delegable` even admin is pinned.
      expect(parse(result).echoedUserId).toBe('service-key-tenant');
    });

    it('does not grant delegation when scopes arrive as a non-array value', async () => {
      const handler = capture([identityTool], { required: true });
      const result = await handler(
        {
          method: 'tools/call',
          params: { name: 'echo_user', arguments: { userId: 'other-tenant' } },
        },
        {
          // A malformed transport could hand us `scopes: 'admin'` (a bare string
          // whose .includes('admin') is true) — it must NOT be read as admin.
          authInfo: {
            scopes: 'admin' as unknown as string[],
            extra: { userId: 'service-key-tenant' },
          },
        }
      );
      expect(parse(result).echoedUserId).toBe('service-key-tenant');
    });

    it('audit-logs a delegated call (with apiKeyId) and stays silent for a pinned one', async () => {
      const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      try {
        const handler = capture([identityTool], { required: true });

        await handler(
          {
            method: 'tools/call',
            params: { name: 'echo_user', arguments: { userId: 'other-tenant' } },
          },
          {
            authInfo: {
              scopes: ['admin'],
              extra: { userId: 'service-key-tenant', apiKeyId: 'key_123' },
            },
          }
        );
        const delegatedLog = logSpy.mock.calls
          .map((c) => String(c[0]))
          .find((m) => m.includes('delegated_user_id'));
        expect(delegatedLog).toBeDefined();
        expect(delegatedLog).toContain('actor=service-key-tenant');
        expect(delegatedLog).toContain('target=other-tenant');
        expect(delegatedLog).toContain('apiKeyId=key_123');

        logSpy.mockClear();
        await handler(
          {
            method: 'tools/call',
            params: { name: 'echo_user', arguments: { userId: 'other-tenant' } },
          },
          {
            authInfo: {
              scopes: ['memories:read'],
              extra: { userId: 'service-key-tenant' },
            },
          }
        );
        expect(
          logSpy.mock.calls.map((c) => String(c[0])).some((m) => m.includes('delegated_user_id'))
        ).toBe(false);
      } finally {
        logSpy.mockRestore();
      }
    });
  });
});

describe('resolveActingUserId', () => {
  // The 4th arg is `toolAllowsDelegation` (from Tool.delegable); pass true to
  // model a delegable tool, false to model the default pinned posture.
  it('lets an admin-scoped principal target another tenant on a delegable tool', () => {
    expect(resolveActingUserId('key-tenant', 'other', ['admin'], true)).toEqual({
      effectiveUserId: 'other',
      delegated: true,
    });
  });

  it('pins even an admin principal when the tool is NOT delegable', () => {
    expect(resolveActingUserId('key-tenant', 'other', ['admin'], false)).toEqual({
      effectiveUserId: 'key-tenant',
      delegated: false,
    });
  });

  it('pins a non-admin principal back to its own tenant', () => {
    expect(resolveActingUserId('key-tenant', 'other', ['memories:write'], true)).toEqual({
      effectiveUserId: 'key-tenant',
      delegated: false,
    });
  });

  it('uses the verified tenant when no userId was requested', () => {
    expect(resolveActingUserId('key-tenant', undefined, ['admin'], true)).toEqual({
      effectiveUserId: 'key-tenant',
      delegated: false,
    });
  });

  it('treats an empty, whitespace-only, or non-string requested userId as absent', () => {
    expect(resolveActingUserId('key-tenant', '', ['admin'], true).effectiveUserId).toBe(
      'key-tenant'
    );
    expect(resolveActingUserId('key-tenant', '   ', ['admin'], true)).toEqual({
      effectiveUserId: 'key-tenant',
      delegated: false,
    });
    expect(resolveActingUserId('key-tenant', 42, ['admin'], true).effectiveUserId).toBe(
      'key-tenant'
    );
  });

  it('is not marked delegated when an admin targets its own tenant', () => {
    expect(resolveActingUserId('key-tenant', 'key-tenant', ['admin'], true)).toEqual({
      effectiveUserId: 'key-tenant',
      delegated: false,
    });
  });

  it('ignores requested userId entirely when scopes are empty', () => {
    expect(resolveActingUserId('key-tenant', 'other', [], true)).toEqual({
      effectiveUserId: 'key-tenant',
      delegated: false,
    });
  });

  it('requires the exact "admin" scope — near-miss scopes never delegate', () => {
    for (const near of ['administrator', 'admin:read', 'superadmin', 'x-admin', 'Admin']) {
      expect(resolveActingUserId('key-tenant', 'other', [near], true)).toEqual({
        effectiveUserId: 'key-tenant',
        delegated: false,
      });
    }
  });
});
