import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { EngramClient } from './client.js';
import type {
  RememberResult,
  RecallResult,
  ReflectResult,
  PromptContextResult,
  IngestConversationResult,
} from './types.js';

const USER_ID = 'clm0000000000000000000000';

type ToolHandler = (args: Record<string, unknown>) => unknown;

function buildStubServer(handlers: Record<string, ToolHandler>): Server {
  const server = new Server(
    { name: 'engram-stub', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: Object.keys(handlers).map((name) => ({
      name,
      description: `stub ${name}`,
      inputSchema: { type: 'object' as const },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const name = request.params.name;
    const handler = handlers[name];
    if (!handler) throw new Error(`Unknown tool: ${name}`);
    const result = handler((request.params.arguments ?? {}) as Record<string, unknown>);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  return server;
}

async function createPair(
  handlers: Record<string, ToolHandler>
): Promise<{ client: EngramClient; server: Server }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildStubServer(handlers);
  await server.connect(serverTransport);
  const client = new EngramClient({ baseUrl: 'http://unused' }, clientTransport);
  return { client, server };
}

describe('EngramClient', () => {
  let client: EngramClient;
  let server: Server;

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  // ─── remember ─────────────────────────────────────────────────────────────

  describe('remember()', () => {
    const stubResult: RememberResult = {
      memoryId: 'clm1111111111111111111111',
      resolvedType: 'long-term',
      wasDeduped: false,
      memory: {
        id: 'clm1111111111111111111111',
        userId: USER_ID,
        content: 'TypeScript is great',
        type: 'long-term',
        tags: [],
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: null,
        scope: null,
      },
    };

    beforeEach(async () => {
      ({ client, server } = await createPair({
        remember: () => stubResult,
      }));
    });

    it('returns memoryId and resolvedType', async () => {
      const result = await client.remember({
        userId: USER_ID,
        content: 'TypeScript is great',
      });
      expect(result.memoryId).toBe(stubResult.memoryId);
      expect(result.resolvedType).toBe('long-term');
      expect(result.wasDeduped).toBe(false);
    });
  });

  // ─── recall ───────────────────────────────────────────────────────────────

  describe('recall()', () => {
    const stubResult: RecallResult = {
      query: 'programming',
      count: 2,
      results: [
        {
          score: 0.92,
          memory: {
            id: 'clm1111111111111111111111',
            userId: USER_ID,
            content: 'TypeScript is statically typed',
            type: 'long-term',
            tags: ['typescript'],
            metadata: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            expiresAt: null,
            scope: null,
          },
        },
        {
          score: 0.85,
          memory: {
            id: 'clm2222222222222222222222',
            userId: USER_ID,
            content: 'Zod validates at runtime',
            type: 'long-term',
            tags: ['zod'],
            metadata: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            expiresAt: null,
            scope: null,
          },
        },
      ],
    };

    beforeEach(async () => {
      ({ client, server } = await createPair({
        recall: () => stubResult,
      }));
    });

    it('returns count and results array', async () => {
      const result = await client.recall({
        userId: USER_ID,
        query: 'programming',
      });
      expect(result.count).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]!.score).toBe(0.92);
      expect(result.results[0]!.memory.content).toBe('TypeScript is statically typed');
    });

    it('passes query and filters to the server', async () => {
      let capturedArgs: Record<string, unknown> = {};
      const { client: c, server: s } = await createPair({
        recall: (args) => {
          capturedArgs = args;
          return { query: '', count: 0, results: [] };
        },
      });

      await c.recall({
        userId: USER_ID,
        query: 'TypeScript',
        limit: 5,
        scope: 'project:alpha',
        tags: ['typescript'],
      });

      expect(capturedArgs['userId']).toBe(USER_ID);
      expect(capturedArgs['query']).toBe('TypeScript');
      expect(capturedArgs['limit']).toBe(5);
      expect(capturedArgs['scope']).toBe('project:alpha');
      expect(capturedArgs['tags']).toEqual(['typescript']);

      await c.close();
      await s.close();
    });
  });

  // ─── forget ───────────────────────────────────────────────────────────────

  describe('forget()', () => {
    beforeEach(async () => {
      ({ client, server } = await createPair({
        forget: (args) => ({
          dryRun: !args['confirm'],
          candidates: [{ memoryId: 'clm1111111111111111111111', content: 'secret', score: 0.95 }],
          deleted: args['confirm'] ? 1 : 0,
          message: args['confirm']
            ? 'Deleted 1 of 1 matched memories.'
            : 'Found 1 candidate(s). Pass confirm=true to delete.',
        }),
      }));
    });

    it('returns dry-run candidates when confirm is false', async () => {
      const result = await client.forget({
        userId: USER_ID,
        query: 'secret',
        confirm: false,
      });
      expect(result.dryRun).toBe(true);
      expect(result.deleted).toBe(0);
      expect(result.candidates).toHaveLength(1);
    });

    it('deletes when confirm is true', async () => {
      const result = await client.forget({
        userId: USER_ID,
        query: 'secret',
        confirm: true,
      });
      expect(result.dryRun).toBe(false);
      expect(result.deleted).toBe(1);
    });
  });

  // ─── reflect ──────────────────────────────────────────────────────────────

  describe('reflect()', () => {
    const stubResult: ReflectResult = {
      query: 'database decisions',
      summary: 'The team consistently chose PostgreSQL for reliability.',
      themes: ['database', 'postgresql'],
      sourceIds: ['clm1111111111111111111111'],
      memoryCount: 1,
      dateRange: {
        earliest: '2025-01-01T00:00:00.000Z',
        latest: '2025-01-05T00:00:00.000Z',
      },
    };

    beforeEach(async () => {
      ({ client, server } = await createPair({
        reflect: () => stubResult,
      }));
    });

    it('returns structured reflection with themes and summary', async () => {
      const result = await client.reflect({
        userId: USER_ID,
        query: 'database decisions',
      });
      expect(result.memoryCount).toBe(1);
      expect(result.themes).toContain('database');
      expect(result.summary).toContain('PostgreSQL');
    });
  });

  // ─── promptContext ─────────────────────────────────────────────────────────

  describe('promptContext()', () => {
    const contextText = 'Memory 1: TypeScript is great.\n\nMemory 2: Use PostgreSQL.';
    const metaBlock: Omit<PromptContextResult, 'context'> = {
      memoryCount: 2,
      estimatedTokens: 20,
      tokenBudget: 2000,
      truncated: false,
      candidatesFound: 3,
    };

    beforeEach(async () => {
      ({ client, server } = await createPair({
        prompt_context: () => 'MULTI',
      }));

      // prompt_context returns two content items — rebuild the server
      await client.close();
      await server.close();

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      server = new Server(
        { name: 'engram-stub', version: '1.0.0' },
        { capabilities: { tools: {} } }
      );
      server.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: [
          { name: 'prompt_context', description: 'stub', inputSchema: { type: 'object' as const } },
        ],
      }));
      server.setRequestHandler(CallToolRequestSchema, () => ({
        content: [
          { type: 'text', text: contextText },
          { type: 'text', text: JSON.stringify(metaBlock) },
        ],
      }));
      await server.connect(serverTransport);
      client = new EngramClient({ baseUrl: 'http://unused' }, clientTransport);
    });

    it('returns context text and token-budget metadata', async () => {
      const result = await client.promptContext({
        userId: USER_ID,
        query: 'TypeScript types',
        tokenBudget: 2000,
      });
      expect(result.context).toBe(contextText);
      expect(result.memoryCount).toBe(2);
      expect(result.estimatedTokens).toBe(20);
      expect(result.tokenBudget).toBe(2000);
      expect(result.truncated).toBe(false);
      expect(result.candidatesFound).toBe(3);
    });

    it('reports truncated=true when budget was tight', async () => {
      await client.close();
      await server.close();

      const [ct, st] = InMemoryTransport.createLinkedPair();
      const tightMeta: Omit<PromptContextResult, 'context'> = {
        ...metaBlock,
        truncated: true,
        estimatedTokens: 100,
        tokenBudget: 100,
        memoryCount: 1,
      };
      server = new Server(
        { name: 'engram-stub', version: '1.0.0' },
        { capabilities: { tools: {} } }
      );
      server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
      server.setRequestHandler(CallToolRequestSchema, () => ({
        content: [
          { type: 'text', text: 'truncated…' },
          { type: 'text', text: JSON.stringify(tightMeta) },
        ],
      }));
      await server.connect(st);
      client = new EngramClient({ baseUrl: 'http://unused' }, ct);

      const result = await client.promptContext({
        userId: USER_ID,
        query: 'many memories',
        tokenBudget: 100,
      });
      expect(result.truncated).toBe(true);
      expect(result.estimatedTokens).toBeLessThanOrEqual(100);
    });
  });

  // ─── ingestConversation ────────────────────────────────────────────────────

  describe('ingestConversation()', () => {
    const stubResult: IngestConversationResult = {
      ingested: 2,
      skipped: 0,
      failed: 0,
      total: 2,
      memoryIds: ['clm1111111111111111111111', 'clm2222222222222222222222'],
    };

    beforeEach(async () => {
      ({ client, server } = await createPair({
        ingest_conversation: () => stubResult,
      }));
    });

    it('returns ingested, skipped, failed, total counts and memoryIds', async () => {
      const result = await client.ingestConversation({
        userId: USER_ID,
        turns: [
          { role: 'user', content: 'What is TypeScript?' },
          {
            role: 'assistant',
            content: 'TypeScript is a typed superset of JavaScript.',
          },
        ],
      });
      expect(result.ingested).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.total).toBe(2);
      expect(result.memoryIds).toHaveLength(2);
    });
  });

  // ─── error handling ────────────────────────────────────────────────────────

  describe('error handling', () => {
    beforeEach(async () => {
      ({ client, server } = await createPair({
        remember: () => {
          throw new Error('Validation failed: content too long');
        },
      }));
    });

    it('propagates tool errors as thrown errors', async () => {
      await expect(
        client.remember({ userId: USER_ID, content: 'x'.repeat(10241) })
      ).rejects.toThrow();
    });

    it('throws when server returns isError=true with JSON error body', async () => {
      await client.close();
      await server.close();

      const [ct, st] = InMemoryTransport.createLinkedPair();
      server = new Server(
        { name: 'engram-stub', version: '1.0.0' },
        { capabilities: { tools: {} } }
      );
      server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
      server.setRequestHandler(CallToolRequestSchema, () => ({
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: 'User not found' }) }],
      }));
      await server.connect(st);
      client = new EngramClient({ baseUrl: 'http://unused' }, ct);

      await expect(client.remember({ userId: USER_ID, content: 'test' })).rejects.toThrow(
        'User not found'
      );
    });
  });

  // ─── auth header ──────────────────────────────────────────────────────────

  describe('Authorization header', () => {
    type MockRequest = { method: string; headers: Headers; body?: string };

    function buildMcpMockFetch(
      toolResultText: string,
      captured: MockRequest[]
    ): import('@modelcontextprotocol/sdk/shared/transport.js').FetchLike {
      return async (url, init) => {
        const ri = init as RequestInit;
        const h =
          ri?.headers instanceof Headers ? ri.headers : new Headers(ri?.headers as HeadersInit);
        captured.push({
          method: ri?.method ?? 'GET',
          headers: h,
          body: ri?.body as string | undefined,
        });

        const method = ri?.method ?? 'GET';

        if (method === 'POST') {
          const body = ri?.body ? (JSON.parse(ri.body as string) as Record<string, unknown>) : {};
          const isRequest = 'id' in body;

          if (isRequest && body['method'] === 'initialize') {
            return new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: body['id'],
                result: {
                  protocolVersion: '2024-11-05',
                  capabilities: { tools: {} },
                  serverInfo: { name: 'test', version: '1.0.0' },
                },
              }),
              {
                status: 200,
                headers: {
                  'Content-Type': 'application/json',
                  'mcp-session-id': 'test-session-id',
                },
              }
            );
          }

          if (!isRequest) {
            // Notification (no id) — return 200 (not 202) so SSE is not opened
            return new Response('', { status: 200 });
          }

          // Tool call
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body['id'],
              result: { content: [{ type: 'text', text: toolResultText }] },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }

        // GET (SSE) — return 405 so transport skips SSE
        return new Response('', { status: 405 });
      };
    }

    it('includes Bearer token in HTTP requests when apiKey is set', async () => {
      const captured: MockRequest[] = [];
      const toolResult = JSON.stringify({ query: '', count: 0, results: [] });

      const apiClient = new EngramClient({
        baseUrl: 'http://localhost:3000',
        apiKey: 'eng_testkey123',
        fetch: buildMcpMockFetch(toolResult, captured),
      });

      await apiClient.recall({ userId: USER_ID, query: 'test' });
      await apiClient.close();

      const initRequest = captured.find((r) => {
        try {
          return r.method === 'POST' && JSON.parse(r.body ?? '{}')?.method === 'initialize';
        } catch {
          return false;
        }
      });
      expect(initRequest).toBeDefined();
      expect(initRequest!.headers.get('Authorization')).toBe('Bearer eng_testkey123');
    });

    it('omits Authorization header when no apiKey is provided', async () => {
      const captured: MockRequest[] = [];
      const toolResult = JSON.stringify({ query: '', count: 0, results: [] });

      const anonClient = new EngramClient({
        baseUrl: 'http://localhost:3000',
        fetch: buildMcpMockFetch(toolResult, captured),
      });

      await anonClient.recall({ userId: USER_ID, query: 'test' });
      await anonClient.close();

      const initRequest = captured.find((r) => {
        try {
          return r.method === 'POST' && JSON.parse(r.body ?? '{}')?.method === 'initialize';
        } catch {
          return false;
        }
      });
      expect(initRequest).toBeDefined();
      expect(initRequest!.headers.get('Authorization')).toBeNull();
    });
  });
});
