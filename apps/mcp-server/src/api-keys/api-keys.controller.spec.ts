import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { GENERIC_CLIENT_ERROR_DETAIL } from '../security/client-error.util';

describe('ApiKeysController', () => {
  let controller: ApiKeysController;
  let service: jest.Mocked<ApiKeysService>;

  const userId = 'cm123456789012345678901234';
  const keyId = 'cm234567890123456789012345';

  const mockKey = {
    id: keyId,
    name: 'My Key',
    prefix: 'eng_AbCdEfGh',
    userId,
    organizationId: null,
    scopes: ['memories:read', 'memories:write'],
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  const parse = <T>(response: { content: Array<{ text: string }> }): T => {
    const first = response.content[0];
    if (!first) throw new Error('No content in response');
    return JSON.parse(first.text) as T;
  };

  beforeEach(async () => {
    process.env.MCP_ADMIN_TOKEN = 'test-admin-token';

    const mockService = {
      createApiKey: jest.fn(),
      listApiKeys: jest.fn(),
      revokeApiKey: jest.fn(),
      verifyApiKey: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiKeysController],
      providers: [{ provide: ApiKeysService, useValue: mockService }],
    }).compile();

    controller = module.get<ApiKeysController>(ApiKeysController);
    service = module.get<ApiKeysService>(
      ApiKeysService,
    ) as jest.Mocked<ApiKeysService>;
  });

  afterEach(() => {
    delete process.env.MCP_ADMIN_TOKEN;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getMcpTools', () => {
    it('exposes create_api_key, list_api_keys, and revoke_api_key tools', () => {
      const tools = controller.getMcpTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('create_api_key');
      expect(names).toContain('list_api_keys');
      expect(names).toContain('revoke_api_key');
    });

    it('every tool has a name, description, inputSchema, and handler', () => {
      for (const tool of controller.getMcpTools()) {
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('never marks the identity-mode key-management tools delegable (#200)', () => {
      // Delegation is opt-in; these destructive credential tools must stay
      // pinned to the caller's own tenant so an admin key cannot list or revoke
      // another tenant's API keys by passing a foreign userId.
      const tools = controller.getMcpTools();
      for (const name of ['list_api_keys', 'revoke_api_key']) {
        const tool = tools.find((t) => t.name === name);
        expect(tool).toBeDefined();
        expect(tool?.delegable).not.toBe(true);
      }
    });
  });

  describe('createApiKey', () => {
    it('returns the raw key and metadata on success', async () => {
      service.createApiKey.mockResolvedValue({
        key: mockKey,
        rawKey: 'eng_AAAABBBBCCCCDDDDEEEEFFFFGGHH1234',
      });

      const response = await controller.createApiKey({
        userId,
        adminToken: 'test-admin-token',
        name: 'My Key',
        scopes: ['memories:read', 'memories:write'],
      });

      const body = parse<{
        key: string;
        id: string;
        warning: string;
      }>(response);

      expect(body.key).toBe('eng_AAAABBBBCCCCDDDDEEEEFFFFGGHH1234');
      expect(body.id).toBe(mockKey.id);
      expect(body.warning).toMatch(/not be shown again/);
    });

    it('throws on invalid input (empty name)', async () => {
      await expect(
        controller.createApiKey({
          userId,
          adminToken: 'test-admin-token',
          name: '',
          scopes: ['memories:read'],
        }),
      ).rejects.toThrow(/Failed to create API key/);
    });

    it('throws when admin token is wrong', async () => {
      service.createApiKey.mockResolvedValue({
        key: mockKey,
        rawKey: 'eng_AAAABBBBCCCCDDDDEEEEFFFFGGHH1234',
      });

      await expect(
        controller.createApiKey({
          userId,
          adminToken: 'wrong-token',
          name: 'Key',
          scopes: ['memories:read'],
        }),
      ).rejects.toThrow(/Failed to create API key/);
      expect(service.createApiKey).not.toHaveBeenCalled();
    });

    it('throws a generic message when the service fails, without internals', async () => {
      service.createApiKey.mockRejectedValue(new Error('DB error'));

      const error = await controller
        .createApiKey({
          userId,
          adminToken: 'test-admin-token',
          name: 'Key',
          scopes: ['memories:read'],
        })
        .then(
          () => {
            throw new Error('expected the call to reject');
          },
          (e: unknown) => e,
        );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        `Failed to create API key: ${GENERIC_CLIENT_ERROR_DETAIL}`,
      );
      expect((error as Error).message).not.toContain('DB error');
    });
  });

  describe('listApiKeys', () => {
    it('returns count and key metadata', async () => {
      service.listApiKeys.mockResolvedValue([mockKey]);

      const response = await controller.listApiKeys({ userId });
      const body = parse<{ count: number; keys: (typeof mockKey)[] }>(response);

      expect(body.count).toBe(1);
      expect(body.keys[0]?.id).toBe(mockKey.id);
      // hash must never appear
      expect(JSON.stringify(body)).not.toContain('hash');
    });

    it('throws on invalid input', async () => {
      await expect(
        controller.listApiKeys({ userId: 'not-a-cuid' }),
      ).rejects.toThrow(/Failed to list API keys/);
    });
  });

  describe('revokeApiKey', () => {
    it('returns revoked flag and metadata on success', async () => {
      service.revokeApiKey.mockResolvedValue({
        ...mockKey,
        revokedAt: new Date('2026-06-21T00:00:00Z'),
      });

      const response = await controller.revokeApiKey({
        userId,
        keyId,
      });

      const body = parse<{ revoked: boolean; id: string }>(response);
      expect(body.revoked).toBe(true);
      expect(body.id).toBe(mockKey.id);
    });

    it('returns revoked=false when key is not found', async () => {
      service.revokeApiKey.mockResolvedValue(null);

      const response = await controller.revokeApiKey({
        userId,
        keyId,
      });

      const body = parse<{ revoked: boolean }>(response);
      expect(body.revoked).toBe(false);
    });

    it('throws on invalid input (bad keyId format)', async () => {
      await expect(
        controller.revokeApiKey({ userId, keyId: 'not-a-cuid' }),
      ).rejects.toThrow(/Failed to revoke API key/);
    });

    it('throws a generic message when the service fails, without internals', async () => {
      service.revokeApiKey.mockRejectedValue(new Error('DB down'));

      const error = await controller.revokeApiKey({ userId, keyId }).then(
        () => {
          throw new Error('expected the call to reject');
        },
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        `Failed to revoke API key: ${GENERIC_CLIENT_ERROR_DETAIL}`,
      );
      expect((error as Error).message).not.toContain('DB down');
    });
  });

  describe('client-facing error hygiene through the MCP tool seam', () => {
    it('list_api_keys handler returns only the generic message on internal errors', async () => {
      service.listApiKeys.mockRejectedValue(
        new Error('connect ECONNREFUSED 10.1.2.3:5432'),
      );

      const tool = controller
        .getMcpTools()
        .find((t) => t.name === 'list_api_keys');
      expect(tool).toBeDefined();

      const error = await tool!.handler({ userId }).then(
        () => {
          throw new Error('expected the handler to reject');
        },
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        `Failed to list API keys: ${GENERIC_CLIENT_ERROR_DETAIL}`,
      );
      expect((error as Error).message).not.toContain('ECONNREFUSED');
    });

    it('create_api_key handler still surfaces the authored admin-auth error', async () => {
      const tool = controller
        .getMcpTools()
        .find((t) => t.name === 'create_api_key');
      expect(tool).toBeDefined();

      await expect(
        // Wrong, but >= the 16-char DTO minimum, so it clears validation and
        // reaches the constant-time admin-token check (the authored error).
        tool!.handler({
          userId,
          adminToken: 'wrong-admin-token-000',
          name: 'Key',
          scopes: ['memories:read'],
        }),
      ).rejects.toThrow(/Unauthorized: invalid admin token/);
    });
  });
});
