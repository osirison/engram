/**
 * Auth-aware tool dispatch tests: identity injection, admin pass-through,
 * required-auth enforcement, and scope enforcement.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerTools, type AuthPolicy, type Tool } from './index';

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
  handler: (input): Promise<unknown> =>
    Promise.resolve({ ok: (input as { userId: string }).userId }),
  requiredScope: 'memories:write',
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
});
