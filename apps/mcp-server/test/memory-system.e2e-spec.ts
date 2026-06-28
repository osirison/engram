/**
 * Memory System E2E Smoke Tests
 *
 * Requires real infrastructure to be running. Gate with E2E_ENABLED=true.
 *
 * Start test infra before running:
 *   docker compose -f docker-compose.test.yml up -d --wait
 *   DATABASE_URL=postgresql://engram_test:test_password@localhost:5433/engram_test \
 *   pnpm -w db:migrate:deploy
 *
 * Run:
 *   E2E_ENABLED=true \
 *   DATABASE_URL=postgresql://engram_test:test_password@localhost:5433/engram_test \
 *   REDIS_URL=redis://localhost:6380 \
 *   QDRANT_URL=http://localhost:6335 \
 *   NODE_ENV=test \
 *   pnpm --filter mcp-server test:e2e
 *
 * Tear down:
 *   docker compose -f docker-compose.test.yml down -v
 */

// Set required env vars before NestJS bootstraps (must happen before any import
// that triggers config validation).
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://engram_test:test_password@localhost:5433/engram_test';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';
process.env.QDRANT_URL = process.env.QDRANT_URL ?? 'http://localhost:6335';
// Use the deterministic local hash provider so E2E recall tests do not require
// an OpenAI API key. The provider produces a stable 1536-dim vector for any
// given text, guaranteeing a cosine score of 1.0 when query === stored content.
process.env.EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER ?? 'local';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { PrismaService } from '@engram/database';
import { AppModule } from '../src/app.module';
import { MemoryService } from '../src/memory/memory.service';

// ---------------------------------------------------------------------------
// Suite guard — skip gracefully when test infra is not available
// ---------------------------------------------------------------------------
const E2E_ENABLED = process.env.E2E_ENABLED === 'true';

const suite: (name: string, fn: () => void) => void = E2E_ENABLED
  ? describe
  : describe.skip;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
suite('Memory System E2E', () => {
  let app: INestApplication;
  let httpServer: Server;
  let memoryService: MemoryService;
  let prismaService: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule.forRoot()],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as Server;
    memoryService = moduleFixture.get(MemoryService);
    prismaService = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // App smoke tests
  // -------------------------------------------------------------------------
  describe('App bootstrap', () => {
    it('should respond to GET /', () => {
      return request(httpServer).get('/').expect(200);
    });

    it('should expose health endpoint', () => {
      return request(httpServer)
        .get('/health')
        .expect((res) => {
          expect([200, 503]).toContain(res.status);
          expect(res.body).toHaveProperty('status');
        });
    });
  });

  // -------------------------------------------------------------------------
  // Semantic recall — remember → recall round-trip
  //
  // Uses EMBEDDING_PROVIDER=local so the test is self-contained (no OpenAI key
  // required). The local provider is deterministic: identical text produces
  // identical vectors, so the stored memory is the top result with score ≈ 1.0.
  // -------------------------------------------------------------------------
  describe('Recall (semantic search)', () => {
    let testUserId: string;
    const testContent =
      'Embeddings represent text as dense vectors in high-dimensional space.';

    beforeAll(async () => {
      // Create a real users row so memories.userId satisfies the FK constraint.
      const user = await prismaService.user.create({
        data: { email: `test-recall-${Date.now()}@e2e.local` },
      });
      testUserId = user.id;
    });

    afterAll(async () => {
      // Deleting the user cascades to its memories (onDelete: Cascade).
      try {
        await prismaService.user.delete({ where: { id: testUserId } });
      } catch {
        // Non-fatal — test isolation via unique userId is sufficient.
      }
    });

    it('returns the stored memory as the top recall result', async () => {
      // Store a long-term memory.
      await memoryService.createMemory({
        userId: testUserId,
        content: testContent,
        type: 'long-term',
        tags: ['ml', 'embeddings'],
      });

      // Recall using the same content as the query. With the local embedding
      // provider the vectors are identical, so score should be very close to 1.
      const results = await memoryService.recall(testUserId, testContent, {
        limit: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      const top = results[0]!;
      expect(top.memory.content).toBe(testContent);
      expect(top.memory.userId).toBe(testUserId);
      expect(top.score).toBeGreaterThan(0.9);
    });

    it('returns an empty array for a user with no memories', async () => {
      const results = await memoryService.recall(
        'no-memories-user-xyz',
        'anything',
        { limit: 5 },
      );
      expect(results).toEqual([]);
    });

    it('scopes results to the requesting user', async () => {
      // A different user should not see test user's memories.
      const results = await memoryService.recall(
        'other-user-xyz',
        testContent,
        {
          limit: 5,
        },
      );
      const leaked = results.filter((r) => r.memory.userId === testUserId);
      expect(leaked).toHaveLength(0);
    });
  });
});
