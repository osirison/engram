import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * SHARED-1 acceptance (canonical `MemoryLink`, DB-gated). Proves against a real
 * migrated Postgres that:
 *  - a deferred link (targetMemoryId = null) is insertable;
 *  - the unique `(sourceMemoryId, targetLocator, relType)` constraint rejects a
 *    duplicate link (idempotent upsert relies on this);
 *  - deleting the SOURCE memory cascade-deletes its outbound links;
 *  - deleting the TARGET memory reverts inbound links to unresolved
 *    (targetMemoryId SET NULL, targetLocator retained) rather than deleting them.
 *
 * Gate: set `MEMORY_LINK_TEST_URL` (or reuse `PGVECTOR_TEST_URL`) to any migrated
 * Postgres. Skipped otherwise. Run locally with:
 *   MEMORY_LINK_TEST_URL=postgresql://engram:...@localhost:5432/engram_wp4_verify \
 *     pnpm --filter @engram/memory-import test
 */
const connectionString = process.env.MEMORY_LINK_TEST_URL ?? process.env.PGVECTOR_TEST_URL;
const describePg = connectionString ? describe : describe.skip;

const TEST_EMAIL = 'wp4-memory-link-int@example.test';

describePg('MemoryLink schema (SHARED-1, integration)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let userId: string;

  async function makeMemory(content: string): Promise<string> {
    const row = await prisma.memory.create({
      data: { userId, content, type: 'long-term', tags: [], embedding: [] },
    });
    return row.id as string;
  }

  beforeAll(async () => {
    const [{ PrismaClient }, { PrismaPg }] = await Promise.all([
      import('@prisma/client'),
      import('@prisma/adapter-pg'),
    ]);
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    // Clean slate: deleting the user cascades memories + links.
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
    const user = await prisma.user.create({ data: { email: TEST_EMAIL } });
    userId = user.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
    await prisma.$disconnect();
  });

  it('inserts a deferred link with targetMemoryId = null', async () => {
    const source = await makeMemory('deferred source');
    const link = await prisma.memoryLink.create({
      data: {
        userId,
        sourceMemoryId: source,
        targetMemoryId: null,
        targetLocator: 'slug:not-yet-imported',
        relType: 'relates-to',
      },
    });
    expect(link.targetMemoryId).toBeNull();
    expect(link.origin).toBe('authored'); // schema default
  });

  it('rejects a duplicate (sourceMemoryId, targetLocator, relType)', async () => {
    const source = await makeMemory('dup source');
    const target = await makeMemory('dup target');
    const base = {
      userId,
      sourceMemoryId: source,
      targetMemoryId: target,
      targetLocator: `id:${target}`,
      relType: 'relates-to',
    };
    await prisma.memoryLink.create({ data: base });
    await expect(prisma.memoryLink.create({ data: base })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('cascade-deletes outbound links when the source memory is deleted', async () => {
    const source = await makeMemory('cascade source');
    const target = await makeMemory('cascade target');
    const link = await prisma.memoryLink.create({
      data: {
        userId,
        sourceMemoryId: source,
        targetMemoryId: target,
        targetLocator: `id:${target}`,
        relType: 'relates-to',
      },
    });
    await prisma.memory.delete({ where: { id: source } });
    expect(await prisma.memoryLink.findUnique({ where: { id: link.id } })).toBeNull();
  });

  it('reverts inbound links to unresolved (SET NULL) when the target memory is deleted', async () => {
    const source = await makeMemory('setnull source');
    const target = await makeMemory('setnull target');
    const link = await prisma.memoryLink.create({
      data: {
        userId,
        sourceMemoryId: source,
        targetMemoryId: target,
        targetLocator: `id:${target}`,
        relType: 'relates-to',
      },
    });
    await prisma.memory.delete({ where: { id: target } });
    const after = await prisma.memoryLink.findUnique({ where: { id: link.id } });
    expect(after).not.toBeNull();
    expect(after.targetMemoryId).toBeNull();
    expect(after.targetLocator).toBe(`id:${target}`); // locator retained for later re-resolution
  });
});
