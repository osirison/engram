import { Test, TestingModule } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import { CorpusConsolidationService } from '@engram/memory-ltm';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { ReindexQueueService } from './reindex-queue.service';
import { ConsolidationService } from './consolidation.service';

/**
 * Wiring tests for the `consolidate_corpus` admin MCP tool (G3-T2), mirroring
 * the reindex tool specs:
 *  - admin gate (assertAdminAuthorized) rejects a wrong/missing token before
 *    any work happens;
 *  - the REVIEW GATE: `dryRun` defaults to TRUE at the tool boundary, so an
 *    argument-less call can never mutate;
 *  - the service summary is returned verbatim as JSON content;
 *  - the tool is distinct from `consolidate_memories` (STM→LTM promotion) and
 *    only advertised when the Postgres-only service is present.
 */
describe('consolidate_corpus tool wiring (G3-T2)', () => {
  const ADMIN_TOKEN = 'test-admin-token-12345';

  const summary = {
    scanned: 12,
    clusters: 2,
    merged: 3,
    skippedConcurrentEdit: 1,
    cursor: null,
    dryRun: true,
    perCluster: [
      {
        canonicalId: 'mem-canonical',
        loserIds: ['mem-loser'],
        scores: [0.9],
        unionedTags: ['alpha'],
      },
    ],
    perClusterTruncated: false,
  };

  const corpusRun = jest.fn();
  const stmLtmRun = jest.fn();

  const buildController = async (
    withCorpusService = true,
  ): Promise<MemoryController> => {
    const providers: Provider[] = [
      { provide: MemoryService, useValue: {} },
      { provide: ReindexQueueService, useValue: {} },
      { provide: ConsolidationService, useValue: { run: stmLtmRun } },
    ];
    if (withCorpusService) {
      providers.push({
        provide: CorpusConsolidationService,
        useValue: { run: corpusRun },
      });
    }
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MemoryController],
      providers,
    }).compile();
    return module.get(MemoryController);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MCP_ADMIN_TOKEN = ADMIN_TOKEN;
    delete process.env.DEPLOYMENT_PROFILE; // standard (default)
    corpusRun.mockResolvedValue(summary);
  });

  it('defaults dryRun to TRUE (review gate) and returns the summary as JSON content', async () => {
    const controller = await buildController();

    const response = await controller.consolidateCorpus({
      adminToken: ADMIN_TOKEN,
    });

    expect(corpusRun).toHaveBeenCalledTimes(1);
    expect(corpusRun).toHaveBeenCalledWith({
      userId: undefined,
      scope: undefined,
      dryRun: true,
      limit: undefined,
      cursor: undefined,
    });

    const payload = JSON.parse(response.content[0]!.text) as typeof summary;
    expect(payload).toEqual(summary);
    // The STM→LTM promotion pass was NOT touched — different tool entirely.
    expect(stmLtmRun).not.toHaveBeenCalled();
  });

  it('passes an explicit dryRun=false and the scoping options through to the service', async () => {
    const controller = await buildController();
    const userId = 'clm0000000000000000000000';

    await controller.consolidateCorpus({
      adminToken: ADMIN_TOKEN,
      userId,
      scope: 'project:engram',
      dryRun: false,
      limit: 500,
      cursor: 'mem-cursor',
    });

    expect(corpusRun).toHaveBeenCalledWith({
      userId,
      scope: 'project:engram',
      dryRun: false,
      limit: 500,
      cursor: 'mem-cursor',
    });
  });

  it('rejects an unauthorized admin token before running anything', async () => {
    const controller = await buildController();

    await expect(
      controller.consolidateCorpus({
        adminToken: 'wrong-token-123456',
      }),
    ).rejects.toThrow(/Failed to consolidate corpus: Unauthorized/);
    expect(corpusRun).not.toHaveBeenCalled();
  });

  it('refuses when MCP_ADMIN_TOKEN is not configured', async () => {
    const controller = await buildController();
    delete process.env.MCP_ADMIN_TOKEN;

    await expect(
      controller.consolidateCorpus({
        adminToken: ADMIN_TOKEN,
      }),
    ).rejects.toThrow(/Failed to consolidate corpus/);
    expect(corpusRun).not.toHaveBeenCalled();

    process.env.MCP_ADMIN_TOKEN = ADMIN_TOKEN;
  });

  it('rejects unknown keys (strict schema)', async () => {
    const controller = await buildController();

    await expect(
      controller.consolidateCorpus({
        adminToken: ADMIN_TOKEN,
        batchSizes: 100,
      }),
    ).rejects.toThrow(/Failed to consolidate corpus/);
    expect(corpusRun).not.toHaveBeenCalled();
  });

  it('fails with a profile message when the Postgres-only service is absent', async () => {
    const controller = await buildController(false);

    await expect(
      controller.consolidateCorpus({
        adminToken: ADMIN_TOKEN,
      }),
    ).rejects.toThrow(/Failed to consolidate corpus/);
  });

  describe('tool registration', () => {
    it('advertises consolidate_corpus when the service is present', async () => {
      const controller = await buildController();
      const tool = controller
        .getMcpTools()
        .find((t) => t.name === 'consolidate_corpus');

      expect(tool).toBeDefined();
      expect(tool!.auth).toBe('admin');
      expect(typeof tool!.handler).toBe('function');
      // The description must disambiguate from the STM→LTM promotion tool.
      expect(tool!.description).toContain('consolidate_memories');
    });

    it('hides consolidate_corpus when the service is absent', async () => {
      const controller = await buildController(false);
      const names = controller.getMcpTools().map((t) => t.name);

      expect(names).not.toContain('consolidate_corpus');
      // The unrelated STM→LTM promotion tool is still there.
      expect(names).toContain('consolidate_memories');
    });
  });
});
