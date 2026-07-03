/**
 * MCP Tools Registry Tests
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import { registerTools, zodToJsonSchema, type Tool } from './index';

describe('MCP Tools Registry', () => {
  let server: Server;

  const getRequestMethod = (schema: unknown): string | undefined => {
    return (schema as { def?: { shape?: { method?: { def?: { values?: string[] } } } } })?.def
      ?.shape?.method?.def?.values?.[0];
  };

  beforeEach(() => {
    // Create a minimal mock server for testing
    server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } });
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
      vi.spyOn(server, 'setRequestHandler').mockImplementation((schema: any, handler: any) => {
        if (getRequestMethod(schema) === 'tools/list') {
          listToolsHandler = handler;
        }
      });

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

      vi.spyOn(server, 'setRequestHandler').mockImplementation((schema: any, handler: any) => {
        if (getRequestMethod(schema) === 'tools/list') {
          listToolsHandler = handler;
        }
      });

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

      vi.spyOn(server, 'setRequestHandler').mockImplementation((schema: any, handler: any) => {
        if (getRequestMethod(schema) === 'tools/call') {
          callToolHandler = handler;
        }
      });

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

      vi.spyOn(server, 'setRequestHandler').mockImplementation((schema: any, handler: any) => {
        if (getRequestMethod(schema) === 'tools/call') {
          callToolHandler = handler;
        }
      });

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

      vi.spyOn(server, 'setRequestHandler').mockImplementation((schema: any, handler: any) => {
        if (getRequestMethod(schema) === 'tools/call') {
          callToolHandler = handler;
        }
      });

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

describe('zodToJsonSchema', () => {
  it('emits draft-07 object schemas', () => {
    const result = zodToJsonSchema(z.object({ name: z.string() }).strict());

    expect(result['$schema']).toBe('http://json-schema.org/draft-07/schema#');
    expect(result.type).toBe('object');
  });

  it('emits properties for string, number, and boolean fields', () => {
    const result = zodToJsonSchema(
      z.object({ a: z.string(), b: z.number(), c: z.boolean() }).strict()
    );

    expect(result['properties']).toMatchObject({
      a: { type: 'string' },
      b: { type: 'number' },
      c: { type: 'boolean' },
    });
    expect(result['required']).toEqual(['a', 'b', 'c']);
  });

  it('emits a property entry for enum fields', () => {
    const result = zodToJsonSchema(
      z.object({ type: z.enum(['short-term', 'long-term']) }).strict()
    );

    const properties = result['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['type']).toMatchObject({
      type: 'string',
      enum: ['short-term', 'long-term'],
    });
    expect(result['required']).toEqual(['type']);
  });

  it('emits a property entry for array fields with item schemas', () => {
    const result = zodToJsonSchema(
      z.object({ tags: z.array(z.string().min(1).max(100)).max(50) }).strict()
    );

    const properties = result['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['tags']).toMatchObject({
      type: 'array',
      maxItems: 50,
      items: { type: 'string', minLength: 1, maxLength: 100 },
    });
    expect(result['required']).toEqual(['tags']);
  });

  it('emits a property entry for nested object and record fields', () => {
    const result = zodToJsonSchema(
      z
        .object({
          nested: z.object({ inner: z.string() }).strict(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .strict()
    );

    const properties = result['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['nested']).toMatchObject({
      type: 'object',
      properties: { inner: { type: 'string' } },
      required: ['inner'],
    });
    expect(properties['metadata']).toMatchObject({ type: 'object' });
    expect(result['required']).toEqual(['nested']);
  });

  it('does not list optional fields as required', () => {
    const result = zodToJsonSchema(
      z.object({ id: z.string(), scope: z.string().optional() }).strict()
    );

    const properties = result['properties'] as Record<string, unknown>;
    expect(properties['scope']).toMatchObject({ type: 'string' });
    expect(result['required']).toEqual(['id']);
  });

  // Regression for issue #205: `.optional().default(...)` is a ZodDefault, which
  // the old converter marked as REQUIRED while omitting it from `properties`.
  it('keeps ZodDefault fields in properties (with default) and out of required', () => {
    const result = zodToJsonSchema(
      z
        .object({
          id: z.string(),
          tags: z.array(z.string()).max(50).optional().default([]),
          limit: z.coerce.number().int().min(1).max(50).optional().default(10),
        })
        .strict()
    );

    const properties = result['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['tags']).toMatchObject({ type: 'array', default: [] });
    expect(properties['limit']).toMatchObject({ type: 'integer', default: 10 });
    expect(result['required']).toEqual(['id']);
  });

  it('keeps nullable fields required while allowing null', () => {
    const result = zodToJsonSchema(z.object({ ref: z.string().nullable() }).strict());

    const properties = result['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['ref']).toMatchObject({
      anyOf: [{ type: 'string' }, { type: 'null' }],
    });
    expect(result['required']).toEqual(['ref']);
  });

  it('marks strict object schemas with additionalProperties: false', () => {
    const result = zodToJsonSchema(z.object({ a: z.string() }).strict());

    expect(result['additionalProperties']).toBe(false);
  });

  it('converts refined object schemas (refinements are validation-only)', () => {
    const result = zodToJsonSchema(
      z
        .object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() })
        .strict()
        .refine((v) => !v.from || !v.to || v.from <= v.to)
    );

    expect(result.type).toBe('object');
    const properties = result['properties'] as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(['from', 'to']);
    expect(result['required']).toBeUndefined();
  });

  it('falls back to a plain object schema for non-object inputs', () => {
    expect(zodToJsonSchema(z.string())).toEqual({ type: 'object' });
  });
});

describe('tools/list advertised schemas (wiring)', () => {
  // Mirrors the shape of create_memory's input schema, including the
  // enum + `.optional().default([])` fields from issue #205.
  const createMemoryLikeSchema = z
    .object({
      userId: z.string().min(1),
      content: z.string().min(1).max(10240),
      type: z.enum(['short-term', 'long-term']),
      scope: z.string().min(1).max(256).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      tags: z.array(z.string().min(1).max(100)).max(50).optional().default([]),
      ttl: z.coerce.number().int().min(60).max(604800).optional(),
    })
    .strict();

  const createMemoryLikeTool: Tool = {
    name: 'create_memory_like',
    description: 'Tool with an enum and a defaulted array field',
    inputSchema: createMemoryLikeSchema,
    handler: async () => ({ ok: true }),
  };

  const listToolsVia = async (tools: Tool[]): Promise<any[]> => {
    const server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } });
    let listToolsHandler: ((request: any) => Promise<any>) | undefined;

    vi.spyOn(server, 'setRequestHandler').mockImplementation((schema: any, handler: any) => {
      const method = (schema as { def?: { shape?: { method?: { def?: { values?: string[] } } } } })
        ?.def?.shape?.method?.def?.values?.[0];
      if (method === 'tools/list') {
        listToolsHandler = handler;
      }
    });

    registerTools(server, tools);

    expect(listToolsHandler).toBeDefined();
    const result = await listToolsHandler!({ method: 'tools/list' });
    return result.tools;
  };

  it('advertises every Zod key in properties and only truly-required keys in required', async () => {
    const tools = await listToolsVia([createMemoryLikeTool]);
    const advertised = tools.find((tool) => tool.name === 'create_memory_like');

    expect(advertised).toBeDefined();
    expect(advertised.inputSchema.type).toBe('object');

    // Every key of the Zod object shape must have a property entry.
    expect(Object.keys(advertised.inputSchema.properties).sort()).toEqual(
      Object.keys(createMemoryLikeSchema.shape).sort()
    );

    // `required` must list exactly the keys that reject an absent value.
    const expectedRequired = Object.entries(createMemoryLikeSchema.shape)
      .filter(([, field]) => !(field as z.ZodType).safeParse(undefined).success)
      .map(([key]) => key)
      .sort();
    expect([...advertised.inputSchema.required].sort()).toEqual(expectedRequired);
    expect(expectedRequired).toEqual(['content', 'type', 'userId']);
  });

  it('advertises the enum field and the defaulted array field correctly (issue #205)', async () => {
    const tools = await listToolsVia([createMemoryLikeTool]);
    const advertised = tools.find((tool) => tool.name === 'create_memory_like');

    expect(advertised.inputSchema.properties.type).toMatchObject({
      type: 'string',
      enum: ['short-term', 'long-term'],
    });
    expect(advertised.inputSchema.properties.tags).toMatchObject({
      type: 'array',
      default: [],
    });
    expect(advertised.inputSchema.required).not.toContain('tags');
    expect(advertised.inputSchema.required).toContain('type');
  });

  it('advertises strict schemas with additionalProperties: false end-to-end', async () => {
    const tools = await listToolsVia([createMemoryLikeTool]);

    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });
});
