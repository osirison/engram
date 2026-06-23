import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import { PrismaService } from '@engram/database';
import { ApiKeysService } from './api-keys.service';

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  let mockApiKey: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    updateMany: jest.Mock;
  };
  let mockExecuteRaw: jest.Mock;

  const userId = 'cm123456789012345678901234';

  function buildKey(
    overrides: {
      id?: string;
      name?: string;
      prefix?: string;
      hash?: string;
      userId?: string;
      organizationId?: string | null;
      scopes?: string[];
      lastUsedAt?: Date | null;
      expiresAt?: Date | null;
      revokedAt?: Date | null;
      createdAt?: Date;
      updatedAt?: Date;
    } = {},
  ): {
    id: string;
    name: string;
    prefix: string;
    hash: string;
    userId: string;
    organizationId: string | null;
    scopes: string[];
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } {
    return {
      id: 'cm_keyid_00001',
      name: 'Test Key',
      prefix: 'eng_AbCdEfGh',
      hash: 'fakehash',
      userId,
      organizationId: null,
      scopes: ['memories:read'],
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    };
  }

  beforeEach(async () => {
    mockApiKey = {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    };
    mockExecuteRaw = jest.fn().mockResolvedValue(1);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        {
          provide: PrismaService,
          useValue: { apiKey: mockApiKey, $executeRaw: mockExecuteRaw },
        },
      ],
    }).compile();

    service = module.get<ApiKeysService>(ApiKeysService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('createApiKey', () => {
    it('creates a key, hashes it, and returns the raw key once', async () => {
      const stored = buildKey();
      mockApiKey.create.mockResolvedValue(stored);

      const result = await service.createApiKey({
        userId,
        name: 'Test Key',
        scopes: ['memories:read'],
      });

      expect(result.rawKey).toMatch(/^eng_[A-Za-z0-9_-]{32}$/);
      expect(result.key).toEqual(stored);

      const createArg = mockApiKey.create.mock.calls[0]?.[0] as {
        data: { hash: string; prefix: string; expiresAt: Date | null };
      };
      const { hash: passedHash, prefix: passedPrefix } = createArg.data;

      const expected = createHash('sha256').update(result.rawKey).digest('hex');
      expect(passedHash).toBe(expected);
      expect(result.rawKey.startsWith(passedPrefix)).toBe(true);
    });

    it('sets expiresAt when expiresInDays is provided', async () => {
      mockApiKey.create.mockResolvedValue(buildKey());

      const before = Date.now();
      await service.createApiKey({
        userId,
        name: 'Expiring Key',
        scopes: ['memories:read'],
        expiresInDays: 7,
      });
      const after = Date.now();

      const createArg = mockApiKey.create.mock.calls[0]?.[0] as {
        data: { expiresAt: Date | null };
      };
      const { expiresAt } = createArg.data;
      expect(expiresAt).toBeInstanceOf(Date);
      expect(expiresAt!.getTime()).toBeGreaterThanOrEqual(
        before + 7 * 86_400_000 - 1000,
      );
      expect(expiresAt!.getTime()).toBeLessThanOrEqual(
        after + 7 * 86_400_000 + 1000,
      );
    });

    it('sets no expiresAt when expiresInDays is omitted', async () => {
      mockApiKey.create.mockResolvedValue(buildKey());

      await service.createApiKey({
        userId,
        name: 'No-expiry Key',
        scopes: ['admin'],
      });

      const createArg = mockApiKey.create.mock.calls[0]?.[0] as {
        data: { expiresAt: Date | null };
      };
      expect(createArg.data.expiresAt).toBeNull();
    });
  });

  describe('listApiKeys', () => {
    it('returns active keys for a user', async () => {
      const keys = [
        buildKey({ id: 'k1' }),
        buildKey({ id: 'k2', name: 'Other' }),
      ];
      mockApiKey.findMany.mockResolvedValue(keys);

      const result = await service.listApiKeys(userId);

      expect(result).toEqual(keys);
      expect(mockApiKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId, revokedAt: null }),
        }),
      );
    });
  });

  describe('revokeApiKey', () => {
    it('revokes an existing key and returns it', async () => {
      const revoked = buildKey({ id: 'key-1', revokedAt: new Date() });
      mockApiKey.updateMany.mockResolvedValue({ count: 1 });
      mockApiKey.findFirst.mockResolvedValue(revoked);

      const result = await service.revokeApiKey(userId, 'key-1');

      expect(result).toEqual(revoked);
      expect(result!.revokedAt).toBeInstanceOf(Date);
      expect(mockApiKey.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'key-1', userId, revokedAt: null },
        }),
      );
    });

    it('returns null when key is not found or already revoked', async () => {
      mockApiKey.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.revokeApiKey(userId, 'nonexistent');

      expect(result).toBeNull();
      expect(mockApiKey.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('verifyApiKey', () => {
    it('returns null for keys without eng_ prefix', async () => {
      const result = await service.verifyApiKey('bad_key');
      expect(result).toBeNull();
      expect(mockApiKey.findFirst).not.toHaveBeenCalled();
    });

    it('returns null when no record matches hash', async () => {
      mockApiKey.findFirst.mockResolvedValue(null);

      const result = await service.verifyApiKey(
        'eng_AAAABBBBCCCCDDDDEEEEFFFFGGHH',
      );
      expect(result).toBeNull();
    });

    it('returns null for expired keys', async () => {
      const expiredKey = buildKey({ expiresAt: new Date(Date.now() - 1000) });
      mockApiKey.findFirst.mockResolvedValue(expiredKey);

      const result = await service.verifyApiKey(
        'eng_AAAABBBBCCCCDDDDEEEEFFFFGGHH',
      );
      expect(result).toBeNull();
      expect(mockExecuteRaw).not.toHaveBeenCalled();
    });

    it('returns the key record for a valid key and fires lastUsedAt update', async () => {
      const rawKey = 'eng_AAAABBBBCCCCDDDDEEEEFFFFGGHH1234';
      const validKey = buildKey({ expiresAt: null });
      mockApiKey.findFirst.mockResolvedValue(validKey);

      const result = await service.verifyApiKey(rawKey);
      expect(result).toEqual(validKey);

      await Promise.resolve();
      expect(mockExecuteRaw).toHaveBeenCalled();
    });
  });
});
