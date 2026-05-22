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

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// ---------------------------------------------------------------------------
// Suite guard — skip gracefully when test infra is not available
// ---------------------------------------------------------------------------
const E2E_ENABLED = process.env.E2E_ENABLED === 'true';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const suite: (name: string, fn: () => void) => void = E2E_ENABLED
  ? describe
  : describe.skip;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
suite('Memory System E2E', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // App smoke tests
  // -------------------------------------------------------------------------
  describe('App bootstrap', () => {
    it('should respond to GET /', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return request(app.getHttpServer()).get('/').expect(200);
    });

    it('should expose health endpoint', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return request(app.getHttpServer())
        .get('/health')
        .expect((res) => {
          expect([200, 503]).toContain(res.status);
          expect(res.body).toHaveProperty('status');
        });
    });
  });
});
