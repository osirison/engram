/**
 * Wiring test for the JSON Schemas advertised via the MCP `tools/list`
 * response (issue #205).
 *
 * The full production tool set (memory tools + API-key tools + the built-in
 * ping tool) is registered through the real `registerTools` dispatcher from
 * `@engram/core`, and the captured `tools/list` handler is invoked exactly as
 * an MCP client would. For EVERY advertised tool we assert:
 *
 *   1. the schema is object-typed draft-07 with `additionalProperties: false`
 *      (all tool schemas are `z.object(...).strict()`),
 *   2. `properties` contains an entry for every key of the Zod input schema
 *      (the old hand-rolled converter dropped enums, arrays, records, and
 *      defaulted fields), and
 *   3. `required` lists exactly the keys that reject an absent value — so a
 *      `.optional().default(...)` field (ZodDefault) must NOT be required.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import { registerTools, pingTool, type Tool } from '@engram/core';
import { MemoryController } from '../memory/memory.controller';
import { MemoryService } from '../memory/memory.service';
import { ReindexQueueService } from '../memory/reindex-queue.service';
import { ConsolidationService } from '../memory/consolidation.service';
import { ApiKeysController } from '../api-keys/api-keys.controller';
import { ApiKeysService } from '../api-keys/api-keys.service';

interface AdvertisedTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
    additionalProperties?: boolean;
    [key: string]: unknown;
  };
}

describe('tools/list advertised JSON Schemas (wiring, issue #205)', () => {
  let registeredTools: Tool[];
  let advertisedTools: AdvertisedTool[];
  let originalDeploymentProfile: string | undefined;
  let originalAdminToken: string | undefined;

  /** Extract the request method literal from an SDK zod request schema. */
  const getRequestMethod = (schema: unknown): string | undefined => {
    return (
      schema as {
        def?: { shape?: { method?: { def?: { values?: string[] } } } };
      }
    )?.def?.shape?.method?.def?.values?.[0];
  };

  beforeAll(async () => {
    // Snapshot the pre-existing values so this suite's env mutations can't
    // leak into other test files run in the same Jest worker process.
    originalDeploymentProfile = process.env.DEPLOYMENT_PROFILE;
    originalAdminToken = process.env.MCP_ADMIN_TOKEN;

    // Enterprise profile (the default) exposes every tool.
    delete process.env.DEPLOYMENT_PROFILE;
    process.env.MCP_ADMIN_TOKEN = 'test-admin-token-12345';

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MemoryController, ApiKeysController],
      providers: [
        {
          provide: MemoryService,
          useValue: {},
        },
        {
          provide: ReindexQueueService,
          useValue: {},
        },
        {
          provide: ConsolidationService,
          useValue: {},
        },
        {
          provide: ApiKeysService,
          useValue: {},
        },
      ],
    }).compile();

    const memoryController = module.get<MemoryController>(MemoryController);
    const apiKeysController = module.get<ApiKeysController>(ApiKeysController);

    // The exact tool set main.ts registers, plus the built-in ping tool the
    // core registry always adds.
    const additionalTools = [
      ...memoryController.getMcpTools(),
      ...apiKeysController.getMcpTools(),
    ];
    registeredTools = [pingTool, ...additionalTools];

    // Register through the real dispatcher and capture the tools/list handler.
    const server = new Server(
      { name: 'test', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    let listToolsHandler:
      | ((request: unknown) => Promise<{ tools: AdvertisedTool[] }>)
      | undefined;

    jest
      .spyOn(server, 'setRequestHandler')
      .mockImplementation((schema: unknown, handler: unknown) => {
        if (getRequestMethod(schema) === 'tools/list') {
          listToolsHandler = handler as (
            request: unknown,
          ) => Promise<{ tools: AdvertisedTool[] }>;
        }
      });

    registerTools(server, additionalTools);

    if (!listToolsHandler) {
      throw new Error('tools/list handler was not registered');
    }
    const result = await listToolsHandler({ method: 'tools/list' });
    advertisedTools = result.tools;
  });

  afterAll(() => {
    if (originalDeploymentProfile === undefined) {
      delete process.env.DEPLOYMENT_PROFILE;
    } else {
      process.env.DEPLOYMENT_PROFILE = originalDeploymentProfile;
    }

    if (originalAdminToken === undefined) {
      delete process.env.MCP_ADMIN_TOKEN;
    } else {
      process.env.MCP_ADMIN_TOKEN = originalAdminToken;
    }
  });

  const advertised = (name: string): AdvertisedTool => {
    const tool = advertisedTools.find((t) => t.name === name);
    if (!tool) {
      throw new Error(`Tool ${name} was not advertised via tools/list`);
    }
    return tool;
  };

  /** Keys of a Zod object schema that reject an absent (undefined) value. */
  const trulyRequiredKeys = (schema: z.ZodObject): string[] => {
    return Object.entries(schema.shape)
      .filter(([, field]) => !(field as z.ZodType).safeParse(undefined).success)
      .map(([key]) => key)
      .sort();
  };

  it('advertises every registered tool', () => {
    expect(advertisedTools.map((t) => t.name).sort()).toEqual(
      registeredTools.map((t) => t.name).sort(),
    );
    // Enterprise profile: 1 built-in + 24 memory + 3 api-key tools.
    expect(advertisedTools).toHaveLength(28);
  });

  it('every advertised schema is a strict draft-07 object schema', () => {
    for (const tool of advertisedTools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.inputSchema.$schema).toBe(
        'http://json-schema.org/draft-07/schema#',
      );
    }
  });

  it('every advertised schema has a property entry for each Zod input key', () => {
    for (const tool of registeredTools) {
      expect(tool.inputSchema).toBeInstanceOf(z.ZodObject);
      const shape = (tool.inputSchema as z.ZodObject).shape;
      const properties = advertised(tool.name).inputSchema.properties ?? {};

      expect(Object.keys(properties).sort()).toEqual(Object.keys(shape).sort());
    }
  });

  it('every advertised schema lists exactly the truly-required keys as required', () => {
    for (const tool of registeredTools) {
      const schema = tool.inputSchema as z.ZodObject;
      const required = advertised(tool.name).inputSchema.required ?? [];

      expect([...required].sort()).toEqual(trulyRequiredKeys(schema));
    }
  });

  describe('create_memory regression (issue #205)', () => {
    it('advertises the enum field `type` in properties and required', () => {
      const schema = advertised('create_memory').inputSchema;

      expect(schema.properties?.type).toMatchObject({
        type: 'string',
        enum: ['short-term', 'long-term'],
      });
      expect(schema.required).toContain('type');
    });

    it('advertises the ZodDefault field `tags` in properties but NOT in required', () => {
      const schema = advertised('create_memory').inputSchema;

      expect(schema.properties?.tags).toMatchObject({
        type: 'array',
        default: [],
        items: { type: 'string' },
      });
      expect(schema.required).not.toContain('tags');
    });

    it('requires exactly userId, content, and type', () => {
      const schema = advertised('create_memory').inputSchema;

      expect([...(schema.required ?? [])].sort()).toEqual([
        'content',
        'type',
        'userId',
      ]);
    });
  });

  it('recall advertises its defaulted limit and optional filters correctly', () => {
    const schema = advertised('recall').inputSchema;

    expect(schema.properties?.limit).toMatchObject({
      type: 'integer',
      default: 10,
    });
    expect([...(schema.required ?? [])].sort()).toEqual(['query', 'userId']);
  });
});
