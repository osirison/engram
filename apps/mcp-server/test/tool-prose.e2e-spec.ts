/**
 * E2E prose asserts for the WP2 structured tool results (#233).
 *
 * WP2 T2/T3/T5 changed `get_memory` / `delete_memory` / `promote_memory` to put
 * a machine-readable JSON item FIRST and keep the human-readable sentence as the
 * LAST content item. Unit tests pin the shape against mocks; this spec pins the
 * prose against the REAL stack (Postgres + Redis + Qdrant via AppModule), so a
 * wording or ordering regression in what agents actually read fails here.
 *
 * Assertions target stable substrings (ids + key phrases), not exact full
 * strings, so cosmetic copy edits don't break the suite.
 *
 * Infra (mirrors memory-system.e2e-spec.ts):
 *   docker compose -f docker-compose.test.yml up -d --wait
 *   DATABASE_URL=postgresql://engram_test:test_password@localhost:5433/engram_test \
 *     pnpm -w db:migrate:deploy
 *   E2E_ENABLED=true DATABASE_URL=… REDIS_URL=… QDRANT_URL=… NODE_ENV=test \
 *     pnpm --filter mcp-server test:e2e
 */

// Set required env before NestJS bootstraps (must precede any config-validating import).
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://engram_test:test_password@localhost:5433/engram_test';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';
process.env.QDRANT_URL = process.env.QDRANT_URL ?? 'http://localhost:6335';
process.env.EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER ?? 'local';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@engram/database';
import { AppModule } from '../src/app.module';
import { MemoryController } from '../src/memory/memory.controller';
import { MemoryService } from '../src/memory/memory.service';

const E2E_ENABLED = process.env.E2E_ENABLED === 'true';
const suite: (name: string, fn: () => void) => void = E2E_ENABLED
  ? describe
  : describe.skip;

/** A syntactically valid cuid that exists in no tenant (not-found probes). */
const MISSING_ID = 'cjld2cjxh0000qzrmn831i7rn';

type ToolResult = { content: Array<{ type: string; text: string }> };

/** First content item — the machine-readable JSON payload (WP2 T2/D2). */
const structured = <T>(result: ToolResult): T => {
  const first = result.content[0];
  if (!first) throw new Error('tool result had no content items');
  return JSON.parse(first.text) as T;
};

/** Last content item — the human-readable sentence (WP2 T2/D2). */
const prose = (result: ToolResult): string =>
  result.content[result.content.length - 1]?.text ?? '';

suite('Tool result prose (get/delete/promote) E2E', () => {
  let app: INestApplication;
  let controller: MemoryController;
  let memoryService: MemoryService;
  let prisma: PrismaService;
  let userId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule.forRoot()],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    controller = moduleFixture.get(MemoryController);
    memoryService = moduleFixture.get(MemoryService);
    prisma = moduleFixture.get(PrismaService);

    const user = await prisma.user.create({
      data: { email: `tool-prose-${Date.now()}@e2e.local` },
    });
    userId = user.id;
  });

  afterAll(async () => {
    // Deleting the user cascades to its memories.
    if (prisma && userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
    if (app) await app.close();
  });

  describe('get_memory', () => {
    it('returns the memory as JSON with no trailing prose when found', async () => {
      const created = await memoryService.createMemory({
        userId,
        content: 'Prose e2e: get target',
        type: 'long-term',
        tags: ['prose-e2e'],
      });

      const result = await controller.getMemory({
        userId,
        memoryId: created.id,
      });

      // Found ⇒ a single machine-readable item; the memory itself IS the result.
      expect(result.content).toHaveLength(1);
      const memory = structured<{ id: string; content: string }>(result);
      expect(memory.id).toBe(created.id);
      expect(memory.content).toBe('Prose e2e: get target');
    });

    it('keeps the not-found sentence as the last item, JSON first', async () => {
      const result = await controller.getMemory({
        userId,
        memoryId: MISSING_ID,
      });

      expect(result.content).toHaveLength(2);
      expect(structured<{ found: boolean; memoryId: string }>(result)).toEqual({
        found: false,
        memoryId: MISSING_ID,
      });
      expect(prose(result)).toContain(`Memory ${MISSING_ID}`);
      expect(prose(result)).toContain('not found');
    });
  });

  describe('delete_memory', () => {
    it('emits the success sentence naming the deleted id', async () => {
      const created = await memoryService.createMemory({
        userId,
        content: 'Prose e2e: delete target',
        type: 'long-term',
        tags: ['prose-e2e'],
      });

      const result = await controller.deleteMemory({
        userId,
        memoryId: created.id,
      });

      expect(
        structured<{ deleted: boolean; memoryId: string }>(result),
      ).toEqual({ deleted: true, memoryId: created.id });
      expect(prose(result)).toContain('Successfully deleted memory');
      expect(prose(result)).toContain(created.id);
    });

    it('emits the not-found sentence when nothing was deleted', async () => {
      const result = await controller.deleteMemory({
        userId,
        memoryId: MISSING_ID,
      });

      expect(
        structured<{ deleted: boolean; memoryId: string }>(result),
      ).toEqual({ deleted: false, memoryId: MISSING_ID });
      expect(prose(result)).toContain(`Memory ${MISSING_ID}`);
      expect(prose(result)).toContain('not found');
    });
  });

  describe('promote_memory', () => {
    it('emits the promotion sentence naming the NEW long-term id', async () => {
      const stm = await memoryService.createMemory({
        userId,
        content: 'Prose e2e: promote target',
        type: 'short-term',
        tags: ['prose-e2e'],
        ttl: 300,
      });

      const result = await controller.promoteMemory({
        userId,
        memoryId: stm.id,
      });

      const payload = structured<{
        promoted: boolean;
        memory: { id: string; type: string };
      }>(result);
      expect(payload.promoted).toBe(true);
      expect(payload.memory.type).toBe('long-term');

      // Promotion mints a NEW id (STM row is deleted); the sentence must name
      // the promoted id — the only id the caller can re-read.
      expect(prose(result)).toContain('Successfully promoted memory');
      expect(prose(result)).toContain('to long-term storage');
      expect(prose(result)).toContain(payload.memory.id);
    });
  });
});
