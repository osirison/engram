import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { MemoryStmService } from './memory-stm.service.js';

describe('MemoryStmModule integration', () => {
  let service: MemoryStmService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let redis: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let embeddings: any;

  const userId = 'clq1234567890abcdef1234';

  beforeEach(async () => {
    redis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      ttl: vi.fn().mockResolvedValue(3600),
      keys: vi.fn().mockResolvedValue([]),
    };

    embeddings = {
      generate: vi.fn().mockResolvedValue({
        embedding: [0.5, 0.6, 0.7],
        model: 'text-embedding-3-small',
        cached: false,
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: MemoryStmService,
          useFactory: () =>
            new MemoryStmService(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              redis as any,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              embeddings as any
            ),
        },
      ],
    }).compile();

    service = moduleRef.get(MemoryStmService);
  });

  it('persists generated embedding in Redis memory payload', async () => {
    await service.create({
      userId,
      content: 'Cache this memory payload',
      ttl: 300,
    });

    expect(embeddings.generate).toHaveBeenCalledWith({ text: 'Cache this memory payload' });
    expect(redis.set).toHaveBeenCalledTimes(1);

    const [, payload] = redis.set.mock.calls[0] as [string, string, number];
    const parsed = JSON.parse(payload);

    expect(parsed.content).toBe('Cache this memory payload');
    expect(parsed.embedding).toEqual([0.5, 0.6, 0.7]);
  });

  it('stores an empty embedding vector in Redis when provider fails', async () => {
    embeddings.generate.mockResolvedValueOnce(null);

    await service.create({
      userId,
      content: 'No embedding available',
      ttl: 300,
    });

    const [, payload] = redis.set.mock.calls[0] as [string, string, number];
    const parsed = JSON.parse(payload);

    expect(parsed.embedding).toEqual([]);
  });
});
