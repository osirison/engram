import { Controller, Injectable, Logger } from '@nestjs/common';
import type { Tool } from '@engram/core';
import { ApiKeysService } from './api-keys.service';
import {
  createApiKeyToolSchema,
  type CreateApiKeyToolInput,
} from './dto/create-api-key.dto';
import {
  listApiKeysToolSchema,
  type ListApiKeysToolInput,
} from './dto/list-api-keys.dto';
import {
  revokeApiKeyToolSchema,
  type RevokeApiKeyToolInput,
} from './dto/revoke-api-key.dto';
import { constantTimeStringEqual } from '../security/admin-token.util';
import {
  ClientFacingError,
  toClientError,
} from '../security/client-error.util';

type McpTextResponse = { content: Array<{ type: 'text'; text: string }> };

@Controller('api-keys')
@Injectable()
export class ApiKeysController {
  private readonly logger = new Logger(ApiKeysController.name);

  constructor(private readonly apiKeysService: ApiKeysService) {}

  private assertAdminAuthorized(adminToken: string): void {
    const expected = process.env.MCP_ADMIN_TOKEN;
    if (!expected) {
      throw new ClientFacingError('MCP_ADMIN_TOKEN is not configured');
    }
    if (!constantTimeStringEqual(adminToken, expected)) {
      throw new ClientFacingError('Unauthorized: invalid admin token');
    }
  }

  /** MCP Tool: create_api_key — issue a new API key (shown once). */
  async createApiKey(input: unknown): Promise<McpTextResponse> {
    try {
      const validated: CreateApiKeyToolInput =
        createApiKeyToolSchema.parse(input);
      this.assertAdminAuthorized(validated.adminToken);
      const result = await this.apiKeysService.createApiKey({
        userId: validated.userId,
        name: validated.name,
        scopes: validated.scopes,
        expiresInDays: validated.expiresInDays,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                key: result.rawKey,
                id: result.key.id,
                prefix: result.key.prefix,
                name: result.key.name,
                scopes: result.key.scopes,
                expiresAt: result.key.expiresAt,
                createdAt: result.key.createdAt,
                warning:
                  'Store this key securely — it will not be shown again.',
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in create_api_key tool:', error);
      throw toClientError(error, 'Failed to create API key');
    }
  }

  /** MCP Tool: list_api_keys — list active (non-revoked, non-expired) keys for a user. */
  async listApiKeys(input: unknown): Promise<McpTextResponse> {
    try {
      const validated: ListApiKeysToolInput =
        listApiKeysToolSchema.parse(input);
      const keys = await this.apiKeysService.listApiKeys(validated.userId);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                count: keys.length,
                keys: keys.map((k) => ({
                  id: k.id,
                  name: k.name,
                  prefix: k.prefix,
                  scopes: k.scopes,
                  lastUsedAt: k.lastUsedAt,
                  expiresAt: k.expiresAt,
                  createdAt: k.createdAt,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in list_api_keys tool:', error);
      throw toClientError(error, 'Failed to list API keys');
    }
  }

  /** MCP Tool: revoke_api_key — immediately revoke an API key by ID. */
  async revokeApiKey(input: unknown): Promise<McpTextResponse> {
    try {
      const validated: RevokeApiKeyToolInput =
        revokeApiKeyToolSchema.parse(input);
      const revoked = await this.apiKeysService.revokeApiKey(
        validated.userId,
        validated.keyId,
      );
      if (!revoked) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { revoked: false, reason: 'Key not found or already revoked' },
                null,
                2,
              ),
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                revoked: true,
                id: revoked.id,
                name: revoked.name,
                prefix: revoked.prefix,
                revokedAt: revoked.revokedAt,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      this.logger.error('Error in revoke_api_key tool:', error);
      throw toClientError(error, 'Failed to revoke API key');
    }
  }

  getMcpTools(): Tool[] {
    return [
      {
        name: 'create_api_key',
        description:
          'Issue a new API key for programmatic agent access. The raw key is returned once and never stored — save it securely.',
        inputSchema: createApiKeyToolSchema,
        // Admin-gated: issues a key FOR an arbitrary userId, so the caller's
        // identity must not overwrite the target userId.
        auth: 'admin',
        handler: this.createApiKey.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'list_api_keys',
        description:
          'List all active (non-revoked, non-expired) API keys for a user. Returns key metadata only — the raw key is never shown again after creation.',
        inputSchema: listApiKeysToolSchema,
        // Identity-scoped: under enforcement a caller may only list their own keys.
        auth: 'identity',
        handler: this.listApiKeys.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
      {
        name: 'revoke_api_key',
        description:
          'Immediately revoke an API key by ID. The key will be rejected on all subsequent requests.',
        inputSchema: revokeApiKeyToolSchema,
        // Identity-scoped: under enforcement a caller may only revoke their own keys.
        auth: 'identity',
        handler: this.revokeApiKey.bind(this) as (
          input: unknown,
        ) => Promise<unknown>,
      },
    ];
  }
}
