import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LinkResolver, type ResolverFact } from './link-resolver.service.js';
import { ImportLedgerService } from '../ledger/import-ledger.service.js';
import { MarkdownAdapter } from '../adapters/markdown.adapter.js';

/**
 * Cross-file link RESOLUTION against a real DB (DB-gated). Unit tests check that
 * each adapter *extracts* links from one file in isolation; this proves the
 * whole chain — an adapter's `sourcePath`/locator normalization must line up
 * with `deriveFactLocators` so a link between two imported files actually
 * resolves to a `targetMemoryId` rather than silently going dangling.
 *
 * Gate: MEMORY_LINK_TEST_URL (or PGVECTOR_TEST_URL) → a migrated Postgres.
 */
const connectionString = process.env.MEMORY_LINK_TEST_URL ?? process.env.PGVECTOR_TEST_URL;
const describePg = connectionString ? describe : describe.skip;

const here = dirname(fileURLToPath(import.meta.url));
const VAULT = join(here, '..', 'adapters', '__fixtures__', 'markdown', 'vault');
const TEST_EMAIL = 'wp4-link-resolve-int@example.test';

describePg('LinkResolver cross-file resolution (integration)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let userId: string;
  let resolver: LinkResolver;

  beforeAll(async () => {
    const [{ PrismaClient }, { PrismaPg }] = await Promise.all([
      import('@prisma/client'),
      import('@prisma/adapter-pg'),
    ]);
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
    userId = (await prisma.user.create({ data: { email: TEST_EMAIL } })).id;
    resolver = new LinkResolver(prisma, new ImportLedgerService(prisma));
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
    await prisma.$disconnect();
  });

  it('resolves both wikilink and relative-md cross-file links to the right memory', async () => {
    const ir = await new MarkdownAdapter().parse(VAULT, {
      importBatchId: 'int-batch',
      importedAt: '2026-07-06T00:00:00.000Z',
    });

    // Persist one memory per fact and build the resolver input.
    const idByPath = new Map<string, string>();
    const facts: ResolverFact[] = [];
    for (const fact of ir.facts) {
      const mem = await prisma.memory.create({
        data: { userId, content: fact.content, type: 'long-term', tags: fact.tags, embedding: [] },
      });
      idByPath.set(fact.sourcePath, mem.id);
      const rf: ResolverFact = {
        memoryId: mem.id,
        sourceTool: fact.sourceTool,
        sourcePath: fact.sourcePath,
        links: fact.links,
      };
      if (fact.anchor !== undefined) rf.anchor = fact.anchor;
      if (fact.frontmatter !== undefined) rf.frontmatter = fact.frontmatter;
      facts.push(rf);
    }

    const summary = await resolver.resolveBatch({ userId, importBatchId: 'int-batch', facts });
    // alpha→beta, alpha→gamma, beta→gamma (wikilinks) + gamma→alpha (relative md).
    expect(summary.resolved).toBeGreaterThanOrEqual(4);

    const alpha = idByPath.get('notes/alpha.md')!;
    const beta = idByPath.get('notes/beta.md')!;
    const gamma = idByPath.get('notes/gamma.md')!;
    expect(alpha && beta && gamma).toBeTruthy();

    // Wikilink alpha → [[beta]] resolved to beta's id.
    const alphaBeta = await prisma.memoryLink.findFirst({
      where: { sourceMemoryId: alpha, targetMemoryId: beta },
    });
    expect(alphaBeta).not.toBeNull();
    expect(alphaBeta.targetLocator).toBe(`id:${beta}`);

    // Relative md gamma → [Alpha](./alpha.md) resolved to alpha's id (sourcePath
    // normalization is what makes this line up).
    const gammaAlpha = await prisma.memoryLink.findFirst({
      where: { sourceMemoryId: gamma, targetMemoryId: alpha },
    });
    expect(gammaAlpha).not.toBeNull();

    // No dangling rows for this user's freshly-imported vault.
    const dangling = await prisma.memoryLink.count({ where: { userId, targetMemoryId: null } });
    expect(dangling).toBe(0);
  });
});
