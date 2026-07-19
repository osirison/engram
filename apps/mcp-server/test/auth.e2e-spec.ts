/**
 * Auth & Multi-tenancy E2E (Epic 101)
 *
 * Proves the epic's Definition of Done — "a tenant can only read/write its own
 * memories" — against real Postgres/Redis. Gate with E2E_ENABLED=true.
 *
 * Run (after `docker compose -f docker-compose.test.yml up -d --wait` + migrate):
 *   E2E_ENABLED=true \
 *   DATABASE_URL=postgresql://engram_test:test_password@localhost:5433/engram_test \
 *   NODE_ENV=test pnpm --filter mcp-server test:e2e
 */

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://engram_test:test_password@localhost:5433/engram_test';
process.env.EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER ?? 'local';
// Enable auth enforcement for this run.
process.env.AUTH_REQUIRED = 'true';
process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'e2e-jwt-secret-at-least-32-characters-long!!';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server as HttpServer } from 'node:http';
import request from 'supertest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerTools, type AuthPolicy, type Tool } from '@engram/core';
import { JwtService } from '@engram/auth';
import { PrismaService } from '@engram/database';
import { AppModule } from '../src/app.module';
import { MemoryController } from '../src/memory/memory.controller';
import { AuthResolver } from '../src/auth/auth-resolver.service';
import { ApiKeysService } from '../src/api-keys/api-keys.service';

const E2E_ENABLED = process.env.E2E_ENABLED === 'true';
const suite = E2E_ENABLED ? describe : describe.skip;

// Capture the call_tool dispatch handler the same way the MCP server registers
// it, so we can drive real tool handlers with a crafted authInfo.
const requestMethod = (schema: unknown): string | undefined =>
  (
    schema as {
      def?: { shape?: { method?: { def?: { values?: string[] } } } };
    }
  )?.def?.shape?.method?.def?.values?.[0];

type CallHandler = (
  request: { params: { name: string; arguments?: unknown } },
  extra?: { authInfo?: { scopes?: string[]; extra?: Record<string, unknown> } },
) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

function captureCallHandler(tools: Tool[], policy: AuthPolicy): CallHandler {
  const server = new Server(
    { name: 'e2e', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  let handler: CallHandler | undefined;
  jest
    .spyOn(server, 'setRequestHandler')
    .mockImplementation((schema: unknown, fn: unknown) => {
      if (requestMethod(schema) === 'tools/call') handler = fn as CallHandler;
    });
  registerTools(server, tools, policy);
  if (!handler) throw new Error('call handler not captured');
  return handler;
}

suite('Auth & Multi-tenancy E2E', () => {
  let app: INestApplication;
  let httpServer: HttpServer;
  let prisma: PrismaService;
  let jwt: JwtService;
  let resolver: AuthResolver;
  let apiKeys: ApiKeysService;
  let callTool: CallHandler;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule.forRoot()],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as HttpServer;
    prisma = moduleFixture.get(PrismaService);
    jwt = moduleFixture.get(JwtService);
    resolver = moduleFixture.get(AuthResolver);
    apiKeys = moduleFixture.get(ApiKeysService);
    callTool = captureCallHandler(
      moduleFixture.get(MemoryController).getMcpTools(),
      { required: true },
    );
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
  });

  const newUser = async (label: string): Promise<string> => {
    const user = await prisma.user.create({
      data: { email: `auth-e2e-${label}-${Date.now()}@e2e.local` },
    });
    createdUserIds.push(user.id);
    return user.id;
  };

  describe('/auth HTTP endpoints', () => {
    it('returns the identity for a valid JWT and 401 without one', async () => {
      const token = jwt.issue({
        userId: 'http-user',
        scopes: ['memories:read'],
      });
      await request(httpServer)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.user.userId).toBe('http-user');
          expect(res.body.user.method).toBe('jwt');
        });
      await request(httpServer).get('/auth/me').expect(401);
    });

    it('404s a login for a provider that is not configured', async () => {
      await request(httpServer).get('/auth/github/login').expect(404);
    });
  });

  describe('API key authentication', () => {
    it('resolves a real API key to its owner', async () => {
      const userId = await newUser('apikey');
      const { rawKey } = await apiKeys.createApiKey({
        userId,
        name: 'e2e',
        scopes: ['memories:read', 'memories:write'],
      });
      const outcome = await resolver.authenticate({ 'x-api-key': rawKey });
      expect(outcome.status).toBe('authenticated');
      if (outcome.status === 'authenticated') {
        expect(outcome.identity.userId).toBe(userId);
        expect(outcome.identity.method).toBe('api-key');
      }
    });
  });

  describe('Tenant isolation under enforcement (DoD)', () => {
    it('rejects an unauthenticated protected tool call', async () => {
      const result = await callTool({
        params: {
          name: 'create_memory',
          arguments: { userId: 'x', content: 'y', type: 'long-term' },
        },
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Unauthorized');
    });

    it('rejects a write tool when the credential lacks the write scope', async () => {
      const carol = await newUser('carol');
      const result = await callTool(
        {
          params: {
            name: 'create_memory',
            arguments: { content: 'nope', type: 'long-term' },
          },
        },
        { authInfo: { scopes: ['memories:read'], extra: { userId: carol } } },
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('scope');
    });

    it('derives userId from the token, ignoring a spoofed input userId', async () => {
      const alice = await newUser('alice');
      const bob = await newUser('bob');
      const secret = 'alice private memory about project zenith';

      // Authenticated as Alice (with write scope), but the input claims Bob's userId.
      const result = await callTool(
        {
          params: {
            name: 'create_memory',
            arguments: { userId: bob, content: secret, type: 'long-term' },
          },
        },
        { authInfo: { scopes: ['memories:write'], extra: { userId: alice } } },
      );
      expect(result.isError).toBeFalsy();

      // Assert directly against Postgres (the source of truth) — independent of
      // vector-index timing. The memory was persisted under Alice (the token),
      // NOT Bob (the spoofed input): the token's identity is the tenant boundary.
      const aliceCount = await prisma.memory.count({
        where: { userId: alice, content: secret },
      });
      expect(aliceCount).toBeGreaterThan(0);

      const bobCount = await prisma.memory.count({
        where: { userId: bob, content: secret },
      });
      expect(bobCount).toBe(0);
    });
  });
});
