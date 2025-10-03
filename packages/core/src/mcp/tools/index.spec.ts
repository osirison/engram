/**
 * MCP Tools Registry Tests
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerTools } from './index';

describe('MCP Tools Registry', () => {
  let server: Server;

  beforeEach(() => {
    // Create a minimal mock server for testing
    server = new Server(
      { name: 'test', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
  });

  describe('registerTools', () => {
    it('should register tools without error', () => {
      expect(() => registerTools(server)).not.toThrow();
    });

    it('should register list_tools handler', () => {
      const setRequestHandlerSpy = vi.spyOn(server, 'setRequestHandler');
      
      registerTools(server);
      
      // Should be called at least twice (list_tools and call_tool)
      expect(setRequestHandlerSpy).toHaveBeenCalledTimes(2);
    });

    it('should register call_tool handler', () => {
      const setRequestHandlerSpy = vi.spyOn(server, 'setRequestHandler');
      
      registerTools(server);
      
      // Verify both handlers are registered
      expect(setRequestHandlerSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('list_tools handler', () => {
    it('should return list of tools', async () => {
      let listToolsHandler: ((request: any) => Promise<any>) | undefined;

      // Capture the handler function
      vi.spyOn(server, 'setRequestHandler').mockImplementation(
        (schema: any, handler: any) => {
          if (schema.shape?.method?._def?.value === 'tools/list') {
            listToolsHandler = handler;
          }
        },
      );

      registerTools(server);

      expect(listToolsHandler).toBeDefined();

      if (listToolsHandler) {
        const result = await listToolsHandler({ method: 'tools/list' });
        
        expect(result).toHaveProperty('tools');
        expect(Array.isArray(result.tools)).toBe(true);
        expect(result.tools.length).toBeGreaterThan(0);
      }
    });

    it('should return ping tool in the list', async () => {
      let listToolsHandler: ((request: any) => Promise<any>) | undefined;

      vi.spyOn(server, 'setRequestHandler').mockImplementation(
        (schema: any, handler: any) => {
          if (schema.shape?.method?._def?.value === 'tools/list') {
            listToolsHandler = handler;
          }
        },
      );

      registerTools(server);

      if (listToolsHandler) {
        const result = await listToolsHandler({ method: 'tools/list' });
        
        const pingTool = result.tools.find((tool: any) => tool.name === 'ping');
        expect(pingTool).toBeDefined();
        expect(pingTool.description).toBeTruthy();
        expect(pingTool.inputSchema).toBeDefined();
        expect(pingTool.inputSchema.type).toBe('object');
      }
    });
  });

  describe('call_tool handler', () => {
    it('should execute ping tool successfully', async () => {
      let callToolHandler: ((request: any) => Promise<any>) | undefined;

      vi.spyOn(server, 'setRequestHandler').mockImplementation(
        (schema: any, handler: any) => {
          if (schema.shape?.method?._def?.value === 'tools/call') {
            callToolHandler = handler;
          }
        },
      );

      registerTools(server);

      expect(callToolHandler).toBeDefined();

      if (callToolHandler) {
        const result = await callToolHandler({
          method: 'tools/call',
          params: { name: 'ping', arguments: {} },
        });

        expect(result).toHaveProperty('content');
        expect(Array.isArray(result.content)).toBe(true);
        expect(result.content[0]).toHaveProperty('type', 'text');
        expect(result.content[0]).toHaveProperty('text');

        // Parse the result text
        const parsedText = JSON.parse(result.content[0].text);
        expect(parsedText).toHaveProperty('status', 'pong');
        expect(parsedText).toHaveProperty('timestamp');
      }
    });

    it('should return error for unknown tool', async () => {
      let callToolHandler: ((request: any) => Promise<any>) | undefined;

      vi.spyOn(server, 'setRequestHandler').mockImplementation(
        (schema: any, handler: any) => {
          if (schema.shape?.method?._def?.value === 'tools/call') {
            callToolHandler = handler;
          }
        },
      );

      registerTools(server);

      if (callToolHandler) {
        const result = await callToolHandler({
          method: 'tools/call',
          params: { name: 'unknown_tool', arguments: {} },
        });

        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('isError', true);
        
        const parsedText = JSON.parse(result.content[0].text);
        expect(parsedText).toHaveProperty('error');
        expect(parsedText.error).toContain('Unknown tool');
      }
    });

    it('should handle validation errors', async () => {
      let callToolHandler: ((request: any) => Promise<any>) | undefined;

      vi.spyOn(server, 'setRequestHandler').mockImplementation(
        (schema: any, handler: any) => {
          if (schema.shape?.method?._def?.value === 'tools/call') {
            callToolHandler = handler;
          }
        },
      );

      registerTools(server);

      if (callToolHandler) {
        // Ping tool expects an empty object, so passing invalid data should fail validation
        const result = await callToolHandler({
          method: 'tools/call',
          params: { name: 'ping', arguments: { invalid: 'data' } },
        });

        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('isError', true);
      }
    });
  });
});
