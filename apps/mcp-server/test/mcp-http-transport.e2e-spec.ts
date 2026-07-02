/**
 * Integration test for the real HTTP → auth-middleware → MCP transport →
 * dispatch chain. This is the linchpin the unit tests cannot cover: it verifies
 * that `req.auth` set by McpAuthMiddleware actually reaches the tool dispatch as
 * `extra.authInfo` THROUGH the real StreamableHTTPServerTransport, and that the
 * binding is PER-REQUEST (not pinned to the session at connect time) — so two
 * requests on the same session with different credentials act as different
 * users. Runs in-process with a stub AuthResolver; no Postgres/Redis required.
 *
 * Lives under test/ (e2e jest config) because it imports express; the unit jest
 * config's broad `.js` module mapper breaks express's transitive `ipaddr.js`.
 * It is NOT gated by E2E_ENABLED — it needs no external infrastructure.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import express, { type Request, type Response } from 'express';
import request, { type Test } from 'supertest';
import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { registerTools, type Tool } from '@engram/core';
import {
  McpAuthMiddleware,
  type AuthedRequest,
} from '../src/auth/mcp-auth.middleware';
import type {
  AuthResolver,
  AuthOutcome,
} from '../src/auth/auth-resolver.service';

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

const whoami: Tool = {
  name: 'whoami',
  description: 'echoes the acting userId',
  inputSchema: z.object({ userId: z.string() }).strict(),
  handler: (input) =>
    Promise.resolve({ actingUserId: (input as { userId: string }).userId }),
};

// Stub resolver: "Authorization: Bearer user-<id>" authenticates as that user.
const stubResolver: AuthResolver = {
  authenticate: (headers: Record<string, string | string[] | undefined>) => {
    const auth = headers['authorization'];
    const value = Array.isArray(auth) ? auth[0] : auth;
    if (!value) return Promise.resolve<AuthOutcome>({ status: 'anonymous' });
    const match = /^Bearer user-(.+)$/.exec(value);
    if (!match) {
      return Promise.resolve<AuthOutcome>({ status: 'invalid', reason: 'bad' });
    }
    return Promise.resolve<AuthOutcome>({
      status: 'authenticated',
      identity: {
        userId: `user-${match[1]}`,
        organizationId: null,
        email: null,
        scopes: ['memories:read', 'memories:write'],
        method: 'jwt',
        apiKeyId: null,
      },
    });
  },
} as unknown as AuthResolver;

function buildApp(): express.Express {
  const app = express();
  const authMiddleware = new McpAuthMiddleware(stubResolver, true);
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const createServer = (): Server => {
    const server = new Server(
      { name: 'test', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    registerTools(server, [whoami], { required: true });
    return server;
  };

  app.post(
    '/mcp',
    express.json(),
    (req, res, next) => {
      void authMiddleware.handle(req, res, next);
    },
    async (req: Request, res: Response) => {
      const sessionId = req.headers['mcp-session-id'];
      let transport =
        typeof sessionId === 'string' ? transports.get(sessionId) : undefined;

      if (!transport) {
        if (!isInitializeRequest(req.body)) {
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'no session' },
            id: null,
          });
          return;
        }
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: (): string => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid): void => {
            transports.set(sid, transport!);
          },
        });
        await createServer().connect(transport);
      }

      await transport.handleRequest(
        req as IncomingMessage & { auth?: unknown },
        res as ServerResponse,
        req.body,
      );
    },
  );

  // Session stream (GET) / teardown (DELETE) mirror main.ts: the auth
  // middleware runs, then identity is enforced explicitly because these verbs
  // carry no body for the middleware's tools/call check to inspect.
  const handleSessionRequest = (req: Request, res: Response): void => {
    if (!(req as AuthedRequest).auth) {
      res
        .status(401)
        .set('WWW-Authenticate', 'Bearer realm="engram"')
        .json({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'Unauthorized: authentication is required',
          },
          id: null,
        });
      return;
    }
    const sessionId = req.headers['mcp-session-id'];
    const transport =
      typeof sessionId === 'string' ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Invalid or missing session ID' },
        id: null,
      });
      return;
    }
    res.status(200).end();
  };
  const authPreHandler = (
    req: Request,
    res: Response,
    next: (err?: unknown) => void,
  ): void => {
    void authMiddleware.handle(req, res, next);
  };
  app.get('/mcp', authPreHandler, handleSessionRequest);
  app.delete('/mcp', authPreHandler, handleSessionRequest);

  return app;
}

async function initSession(app: express.Express): Promise<string> {
  const res = await request(app)
    .post('/mcp')
    .set(MCP_HEADERS)
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
    });
  expect(res.status).toBe(200);
  const sessionId = res.headers['mcp-session-id'];
  expect(typeof sessionId).toBe('string');
  return sessionId as string;
}

function callWhoami(
  app: express.Express,
  sessionId: string,
  bearer?: string,
): Test {
  const req = request(app)
    .post('/mcp')
    .set({ ...MCP_HEADERS, 'mcp-session-id': sessionId });
  if (bearer) req.set('Authorization', bearer);
  return req.send({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'whoami', arguments: {} },
  });
}

function actingUserId(body: unknown): string {
  const typed = body as { result?: { content?: Array<{ text: string }> } };
  const text = typed.result?.content?.[0]?.text ?? '{}';
  return (JSON.parse(text) as { actingUserId?: string }).actingUserId ?? '';
}

describe('MCP HTTP transport -> auth -> dispatch (linchpin)', () => {
  it('forwards req.auth to the dispatch as authInfo, per request', async () => {
    const app = buildApp();
    const sessionId = await initSession(app);

    const asAlice = await callWhoami(app, sessionId, 'Bearer user-alice');
    expect(asAlice.status).toBe(200);
    expect(actingUserId(asAlice.body)).toBe('user-alice');

    // SAME session, DIFFERENT credential -> must act as Bob, proving auth info
    // is bound per-request and does not stick from the first call.
    const asBob = await callWhoami(app, sessionId, 'Bearer user-bob');
    expect(asBob.status).toBe(200);
    expect(actingUserId(asBob.body)).toBe('user-bob');
  });

  it('rejects an unauthenticated tool call with 401 over HTTP', async () => {
    const app = buildApp();
    const sessionId = await initSession(app);
    const res = await callWhoami(app, sessionId); // no Authorization
    expect(res.status).toBe(401);
  });

  it.each(['get', 'delete'] as const)(
    'rejects an unauthenticated session %s /mcp with 401 (no body to inspect)',
    async (method) => {
      const app = buildApp();
      const sessionId = await initSession(app);
      const res = await request(app)
        [method]('/mcp')
        .set({ ...MCP_HEADERS, 'mcp-session-id': sessionId }); // no Authorization
      expect(res.status).toBe(401);
    },
  );

  it.each(['get', 'delete'] as const)(
    'lets an authenticated session %s /mcp past the auth gate',
    async (method) => {
      const app = buildApp();
      const sessionId = await initSession(app);
      const res = await request(app)
        [method]('/mcp')
        .set({
          ...MCP_HEADERS,
          'mcp-session-id': sessionId,
          Authorization: 'Bearer user-alice',
        });
      // Past the 401 auth gate: a known session resolves (200), not rejected.
      expect(res.status).not.toBe(401);
    },
  );
});
