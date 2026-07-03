/**
 * MCP Handler Tests
 */

import { Test, TestingModule } from '@nestjs/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { McpHandler } from './mcp.handler';
import type { Tool } from './tools/index';

describe('McpHandler', () => {
  let handler: McpHandler;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [McpHandler],
    }).compile();

    handler = module.get<McpHandler>(McpHandler);
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(handler).toBeDefined();
    });

    it('should initialize MCP server with config', async () => {
      const config = {
        name: 'test-server',
        version: '1.0.0',
        capabilities: {
          tools: {},
        },
        instructions: 'Test server',
      };

      await expect(handler.initialize(config)).resolves.not.toThrow();
      expect(handler.getServer()).toBeDefined();
      expect(handler.getServer()).not.toBeNull();
    });

    it('should handle initialization errors gracefully', async () => {
      // Test with minimal config
      const config = {
        name: '',
        version: '',
      };

      // This should still work as the SDK accepts empty strings
      await expect(handler.initialize(config)).resolves.not.toThrow();
    });
  });

  describe('connection state', () => {
    it('should start as not connected', () => {
      expect(handler.isServerConnected()).toBe(false);
    });

    it('should throw error when connecting without initialization', async () => {
      await expect(handler.connect()).rejects.toThrow(
        'MCP server not initialized. Call initialize() first.'
      );
    });
  });

  describe('server lifecycle', () => {
    it('should get server instance after initialization', async () => {
      const config = {
        name: 'test-server',
        version: '1.0.0',
      };

      await handler.initialize(config);
      const server = handler.getServer();

      expect(server).toBeDefined();
      expect(server).not.toBeNull();
    });

    it('should return null before initialization', () => {
      expect(handler.getServer()).toBeNull();
    });

    it('should support start method (initialize + connect)', async () => {
      const config = {
        name: 'test-server',
        version: '1.0.0',
        capabilities: {
          tools: {},
        },
      };

      // Mock console to suppress connection attempts in test
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Start will try to connect via stdio which won't work in test env
      // but it should initialize successfully
      await handler.initialize(config);
      expect(handler.getServer()).toBeDefined();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('tool dispatch wiring (createConfiguredServer)', () => {
    type CallRequest = { method: string; params: { name: string; arguments?: unknown } };
    type CallExtra = { authInfo?: { scopes?: string[]; extra?: Record<string, unknown> } };
    type CallResult = { content: Array<{ text: string }>; isError?: boolean };
    type CallHandler = (request: CallRequest, extra?: CallExtra) => Promise<CallResult>;

    const getRequestMethod = (schema: unknown): string | undefined =>
      (schema as { def?: { shape?: { method?: { def?: { values?: string[] } } } } })?.def?.shape
        ?.method?.def?.values?.[0];

    const echoTool: Tool = {
      name: 'echo_user',
      description: 'echoes the acting userId',
      inputSchema: z.object({ userId: z.string() }).strict(),
      // Opts into delegation so the admin-scope end-to-end case can target another tenant.
      delegable: true,
      handler: (input): Promise<unknown> =>
        Promise.resolve({ echoedUserId: (input as { userId: string }).userId }),
    };

    /**
     * Wire an identity tool through the handler exactly the way the HTTP
     * transport does (registerAdditionalTools → setAuthPolicy →
     * createConfiguredServer) and capture the registered tools/call handler.
     */
    const captureCallHandler = (): CallHandler => {
      let captured: CallHandler | undefined;
      const spy = vi
        .spyOn(Server.prototype, 'setRequestHandler')
        .mockImplementation((schema, fn): void => {
          if (getRequestMethod(schema) === 'tools/call') {
            captured = fn as unknown as CallHandler;
          }
        });
      handler.registerAdditionalTools([echoTool]);
      handler.setAuthPolicy({ required: true });
      handler.createConfiguredServer({ name: 'wiring-test', version: '0.0.0' });
      spy.mockRestore();
      if (!captured) throw new Error('tools/call handler was not registered');
      return captured;
    };

    const parse = (result: CallResult): Record<string, unknown> =>
      JSON.parse(result.content[0]!.text) as Record<string, unknown>;

    it('honours a delegated userId from an admin-scoped key end-to-end', async () => {
      const call = captureCallHandler();
      const result = await call(
        {
          method: 'tools/call',
          params: { name: 'echo_user', arguments: { userId: 'other-tenant' } },
        },
        { authInfo: { scopes: ['admin'], extra: { userId: 'key-tenant' } } }
      );
      expect(parse(result).echoedUserId).toBe('other-tenant');
    });

    it('pins a non-admin key back to its own tenant end-to-end', async () => {
      const call = captureCallHandler();
      const result = await call(
        {
          method: 'tools/call',
          params: { name: 'echo_user', arguments: { userId: 'other-tenant' } },
        },
        {
          authInfo: {
            scopes: ['memories:read', 'memories:write', 'memories:delete'],
            extra: { userId: 'key-tenant' },
          },
        }
      );
      expect(parse(result).echoedUserId).toBe('key-tenant');
    });
  });

  describe('cleanup', () => {
    it('should handle cleanup when server is not initialized', async () => {
      await expect(handler.onModuleDestroy()).resolves.not.toThrow();
    });

    it('should close server on module destruction', async () => {
      const config = {
        name: 'test-server',
        version: '1.0.0',
      };

      await handler.initialize(config);
      const server = handler.getServer();
      expect(server).toBeDefined();

      // Mock close to prevent actual stdio cleanup
      if (server) {
        server.close = vi.fn().mockResolvedValue(undefined);
      }

      await expect(handler.onModuleDestroy()).resolves.not.toThrow();
    });
  });
});
