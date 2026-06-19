import { Test, TestingModule } from '@nestjs/testing';
import { ScheduleModule } from '@nestjs/schedule';
import { MemoryLtmService } from '@engram/memory-ltm';
import {
  InsightExtractionService,
  type InsightExtractionResult,
} from './insight-extraction.service';

const makeLtmMock = (): {
  findInsightCandidates: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
} => ({
  findInsightCandidates: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockResolvedValue({ id: 'insight-1' }),
  update: jest.fn().mockResolvedValue({}),
});

const makeMemory = (
  overrides: Partial<{
    id: string;
    userId: string;
    organizationId: string | null;
    content: string;
    tags: string[];
    metadata: Record<string, unknown> | null;
  }> = {},
): {
  id: string;
  userId: string;
  organizationId: string | null;
  content: string;
  type: 'long-term';
  tags: string[];
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: null;
  accessCount: number;
} => ({
  id: 'mem-1',
  userId: 'user-1',
  organizationId: null,
  content: 'We decided to refactor the auth service to use JWT tokens.',
  type: 'long-term' as const,
  tags: ['decision'],
  metadata: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  expiresAt: null,
  accessCount: 0,
  ...overrides,
});

const buildModule = async (
  ltmMock?: ReturnType<typeof makeLtmMock>,
): Promise<InsightExtractionService> => {
  const providers = [
    InsightExtractionService,
    ...(ltmMock ? [{ provide: MemoryLtmService, useValue: ltmMock }] : []),
  ];

  const module: TestingModule = await Test.createTestingModule({
    imports: [ScheduleModule.forRoot()],
    providers,
  }).compile();

  return module.get(InsightExtractionService);
};

describe('InsightExtractionService', () => {
  beforeEach(() => {
    delete process.env['MEMORY_INSIGHT_INTERVAL_MS'];
    delete process.env['MEMORY_INSIGHT_MIN_CLUSTER_SIZE'];
    delete process.env['MEMORY_INSIGHT_MAX_CLUSTER_SIZE'];
    process.env['OPENAI_API_KEY'] = 'test-key';
  });

  afterEach(() => {
    delete process.env['MEMORY_INSIGHT_INTERVAL_MS'];
    delete process.env['MEMORY_INSIGHT_MIN_CLUSTER_SIZE'];
    delete process.env['MEMORY_INSIGHT_MAX_CLUSTER_SIZE'];
    delete process.env['OPENAI_API_KEY'];
  });

  describe('run()', () => {
    it('returns zeros and skips all work when LTM service is absent', async () => {
      const service = await buildModule();

      const result = await service.run();

      expect(result).toEqual<InsightExtractionResult>({
        insightsCreated: 0,
        memoriesClustered: 0,
        skippedTopics: 0,
      });
    });

    it('skips a topic when fewer than minClusterSize candidates exist', async () => {
      process.env['MEMORY_INSIGHT_MIN_CLUSTER_SIZE'] = '3';
      const ltm = makeLtmMock();
      ltm.findInsightCandidates.mockImplementation((topic: string) =>
        Promise.resolve(
          topic === 'decision'
            ? [makeMemory({ id: 'mem-1' }), makeMemory({ id: 'mem-2' })]
            : [],
        ),
      );
      const service = await buildModule(ltm);
      jest
        .spyOn(
          service as unknown as { summarizeCluster: () => Promise<string> },
          'summarizeCluster',
        )
        .mockResolvedValue('insight text');

      const result = await service.run();

      expect(ltm.create).not.toHaveBeenCalled();
      expect(result.insightsCreated).toBe(0);
      expect(result.skippedTopics).toBeGreaterThan(0);
    });

    it('creates an insight and annotates source memories with clustered tag', async () => {
      process.env['MEMORY_INSIGHT_MIN_CLUSTER_SIZE'] = '3';
      const candidates = [
        makeMemory({ id: 'mem-1', tags: ['decision'] }),
        makeMemory({ id: 'mem-2', tags: ['decision'] }),
        makeMemory({ id: 'mem-3', tags: ['decision'] }),
      ];
      const ltm = makeLtmMock();
      ltm.findInsightCandidates.mockImplementation((topic: string) =>
        Promise.resolve(topic === 'decision' ? candidates : []),
      );
      ltm.create.mockResolvedValue({ id: 'insight-abc' });
      const service = await buildModule(ltm);
      jest
        .spyOn(
          service as unknown as { summarizeCluster: () => Promise<string> },
          'summarizeCluster',
        )
        .mockResolvedValue('Insight summary text');

      const result = await service.run();

      expect(ltm.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          content: 'Insight summary text',
          tags: expect.arrayContaining(['insight', 'decision']),
          metadata: expect.objectContaining({
            isInsight: true,
            topic: 'decision',
            clusterSize: 3,
            sourceMemoryIds: ['mem-1', 'mem-2', 'mem-3'],
          }),
          skipDuplicateCheck: true,
        }),
      );

      // Source memories annotated with insightId via metadataMerge and 'clustered' tag
      expect(ltm.update).toHaveBeenCalledTimes(3);
      expect(ltm.update).toHaveBeenCalledWith(
        'user-1',
        'mem-1',
        expect.objectContaining({
          metadataMerge: expect.objectContaining({ insightId: 'insight-abc' }),
          tags: expect.arrayContaining(['clustered']),
        }),
        undefined,
      );

      expect(result.insightsCreated).toBe(1);
      expect(result.memoriesClustered).toBe(3);
    });

    it('skips insight creation when summarizeCluster returns null (no API key)', async () => {
      process.env['MEMORY_INSIGHT_MIN_CLUSTER_SIZE'] = '2';
      const ltm = makeLtmMock();
      ltm.findInsightCandidates.mockResolvedValue([
        makeMemory({ id: 'mem-1', tags: ['engineering'] }),
        makeMemory({ id: 'mem-2', tags: ['engineering'] }),
        makeMemory({ id: 'mem-3', tags: ['engineering'] }),
      ]);
      const service = await buildModule(ltm);
      jest
        .spyOn(
          service as unknown as {
            summarizeCluster: () => Promise<string | null>;
          },
          'summarizeCluster',
        )
        .mockResolvedValue(null);

      const result = await service.run();

      expect(ltm.create).not.toHaveBeenCalled();
      expect(result.insightsCreated).toBe(0);
      expect(result.skippedTopics).toBeGreaterThan(0);
    });

    it('groups candidates by user so insights are tenant-scoped', async () => {
      process.env['MEMORY_INSIGHT_MIN_CLUSTER_SIZE'] = '2';
      const ltm = makeLtmMock();
      ltm.findInsightCandidates.mockImplementation((topic: string) =>
        Promise.resolve(
          topic === 'milestone'
            ? [
                makeMemory({
                  id: 'u1-mem-1',
                  userId: 'user-A',
                  tags: ['milestone'],
                }),
                makeMemory({
                  id: 'u1-mem-2',
                  userId: 'user-A',
                  tags: ['milestone'],
                }),
                makeMemory({
                  id: 'u2-mem-1',
                  userId: 'user-B',
                  tags: ['milestone'],
                }),
                makeMemory({
                  id: 'u2-mem-2',
                  userId: 'user-B',
                  tags: ['milestone'],
                }),
              ]
            : [],
        ),
      );
      ltm.create
        .mockResolvedValueOnce({ id: 'insight-A' })
        .mockResolvedValueOnce({ id: 'insight-B' });
      const service = await buildModule(ltm);
      jest
        .spyOn(
          service as unknown as { summarizeCluster: () => Promise<string> },
          'summarizeCluster',
        )
        .mockResolvedValue('cluster insight');

      const result = await service.run();

      expect(ltm.create).toHaveBeenCalledTimes(2);
      expect(ltm.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-A' }),
      );
      expect(ltm.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-B' }),
      );
      expect(result.insightsCreated).toBe(2);
      expect(result.memoriesClustered).toBe(4);
    });

    it('caps cluster size to MEMORY_INSIGHT_MAX_CLUSTER_SIZE', async () => {
      process.env['MEMORY_INSIGHT_MIN_CLUSTER_SIZE'] = '2';
      process.env['MEMORY_INSIGHT_MAX_CLUSTER_SIZE'] = '2';
      const ltm = makeLtmMock();
      ltm.findInsightCandidates.mockImplementation((topic: string) =>
        Promise.resolve(
          topic === 'product'
            ? Array.from({ length: 5 }, (_, i) =>
                makeMemory({ id: `mem-${i}`, tags: ['product'] }),
              )
            : [],
        ),
      );
      const service = await buildModule(ltm);
      jest
        .spyOn(
          service as unknown as { summarizeCluster: () => Promise<string> },
          'summarizeCluster',
        )
        .mockResolvedValue('capped summary');

      await service.run();

      expect(ltm.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ clusterSize: 2 }),
        }),
      );
    });

    it('continues to next user when insight creation fails', async () => {
      process.env['MEMORY_INSIGHT_MIN_CLUSTER_SIZE'] = '2';
      const ltm = makeLtmMock();
      ltm.findInsightCandidates.mockImplementation((topic: string) =>
        Promise.resolve(
          topic === 'learning'
            ? [
                makeMemory({
                  id: 'mem-1',
                  userId: 'user-A',
                  tags: ['learning'],
                }),
                makeMemory({
                  id: 'mem-2',
                  userId: 'user-A',
                  tags: ['learning'],
                }),
                makeMemory({
                  id: 'mem-3',
                  userId: 'user-B',
                  tags: ['learning'],
                }),
                makeMemory({
                  id: 'mem-4',
                  userId: 'user-B',
                  tags: ['learning'],
                }),
              ]
            : [],
        ),
      );
      ltm.create
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({ id: 'insight-B' });
      const service = await buildModule(ltm);
      jest
        .spyOn(
          service as unknown as { summarizeCluster: () => Promise<string> },
          'summarizeCluster',
        )
        .mockResolvedValue('summary');

      const result = await service.run();

      expect(result.insightsCreated).toBe(1);
    });

    it('throws from annotateSourceMemories when all annotations fail, preventing insightsCreated increment', async () => {
      process.env['MEMORY_INSIGHT_MIN_CLUSTER_SIZE'] = '2';
      const ltm = makeLtmMock();
      ltm.findInsightCandidates.mockImplementation((topic: string) =>
        Promise.resolve(
          topic === 'engineering'
            ? [
                makeMemory({ id: 'mem-1', tags: ['engineering'] }),
                makeMemory({ id: 'mem-2', tags: ['engineering'] }),
              ]
            : [],
        ),
      );
      ltm.create.mockResolvedValue({ id: 'insight-x' });
      ltm.update.mockRejectedValue(new Error('DB down'));
      const service = await buildModule(ltm);
      jest
        .spyOn(
          service as unknown as { summarizeCluster: () => Promise<string> },
          'summarizeCluster',
        )
        .mockResolvedValue('summary');

      const result = await service.run();

      // Insight was created but annotation fully failed → counted as error, not success
      expect(result.insightsCreated).toBe(0);
    });

    it('enforces minClusterSize >= 1: MEMORY_INSIGHT_MIN_CLUSTER_SIZE=0 uses fallback of 3', async () => {
      process.env['MEMORY_INSIGHT_MIN_CLUSTER_SIZE'] = '0';
      const ltm = makeLtmMock();
      ltm.findInsightCandidates.mockImplementation((topic: string) =>
        Promise.resolve(
          topic === 'decision'
            ? [makeMemory({ id: 'mem-1', tags: ['decision'] })]
            : [],
        ),
      );
      const service = await buildModule(ltm);
      jest
        .spyOn(
          service as unknown as { summarizeCluster: () => Promise<string> },
          'summarizeCluster',
        )
        .mockResolvedValue('summary');

      const result = await service.run();

      // Single-memory bucket doesn't meet the fallback minClusterSize of 3
      expect(ltm.create).not.toHaveBeenCalled();
      expect(result.skippedTopics).toBeGreaterThan(0);
    });

    it('enforces maxClusterSize >= 1: MEMORY_INSIGHT_MAX_CLUSTER_SIZE=0 uses fallback of 10', async () => {
      process.env['MEMORY_INSIGHT_MAX_CLUSTER_SIZE'] = '0';
      const ltm = makeLtmMock();
      ltm.findInsightCandidates.mockImplementation((topic: string) =>
        Promise.resolve(
          topic === 'decision'
            ? Array.from({ length: 5 }, (_, i) =>
                makeMemory({ id: `mem-${i}`, tags: ['decision'] }),
              )
            : [],
        ),
      );
      const service = await buildModule(ltm);
      jest
        .spyOn(
          service as unknown as { summarizeCluster: () => Promise<string> },
          'summarizeCluster',
        )
        .mockResolvedValue('summary');

      const result = await service.run();

      // fallback=10, 5 candidates meet minClusterSize=3 → insight created
      expect(ltm.create).toHaveBeenCalled();
      expect(result.insightsCreated).toBeGreaterThan(0);
    });

    it('returns zeros without scanning DB when OPENAI_API_KEY is absent', async () => {
      delete process.env['OPENAI_API_KEY'];
      const ltm = makeLtmMock();
      const service = await buildModule(ltm);

      const result = await service.run();

      expect(ltm.findInsightCandidates).not.toHaveBeenCalled();
      expect(result).toEqual<InsightExtractionResult>({
        insightsCreated: 0,
        memoriesClustered: 0,
        skippedTopics: 0,
      });
    });

    it('skips overlapping execution and returns zeros for the second call', async () => {
      process.env['MEMORY_INSIGHT_MIN_CLUSTER_SIZE'] = '1';
      const ltm = makeLtmMock();
      ltm.findInsightCandidates.mockImplementation((topic: string) =>
        Promise.resolve(
          topic === 'engineering'
            ? [makeMemory({ id: 'mem-1', tags: ['engineering'] })]
            : [],
        ),
      );
      const service = await buildModule(ltm);

      let resolveFirst!: (value: string) => void;
      const blockingPromise = new Promise<string>(
        (resolve) => (resolveFirst = resolve),
      );
      jest
        .spyOn(
          service as unknown as { summarizeCluster: () => Promise<string> },
          'summarizeCluster',
        )
        .mockReturnValue(blockingPromise);

      // First run starts and suspends inside summarizeCluster; isRunning=true is set
      // synchronously before the first await, so the second call sees it immediately.
      const firstRun = service.run();
      const secondResult = await service.run();

      resolveFirst('insight text');
      await firstRun;

      expect(secondResult).toEqual<InsightExtractionResult>({
        insightsCreated: 0,
        memoriesClustered: 0,
        skippedTopics: 0,
      });
    });
  });

  describe('lifecycle', () => {
    it('disables scheduler when MEMORY_INSIGHT_INTERVAL_MS=0', async () => {
      process.env['MEMORY_INSIGHT_INTERVAL_MS'] = '0';
      const service = await buildModule();

      service.onModuleInit();
      expect(() => service.onModuleDestroy()).not.toThrow();
    });

    it('registers and cleans up the interval on init/destroy', async () => {
      process.env['MEMORY_INSIGHT_INTERVAL_MS'] = '999999';
      const service = await buildModule();

      service.onModuleInit();
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });
});
