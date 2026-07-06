/**
 * Wiring test for the `export_memories` MCP tool (WP3 T7). Proves the tool is
 * registered, identity-mode + delegable, scope-gated on `memories:read`, and
 * that delegation/scope enforcement flows through the REAL core dispatch
 * (`registerTools`) — mirroring `mcp-delegation-wiring.spec.ts`. Also covers the
 * handler's inline-vs-server-path result branch.
 */
import { Test, TestingModule } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerTools, type Tool } from '@engram/core';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { ReindexQueueService } from './reindex-queue.service';
import { ConsolidationService } from './consolidation.service';
import { MemoryExportService } from './export/memory-export.service';
import type { ExportSink } from './export/export.types';

const KEY_TENANT = 'cjld2cjxh0000qzrmn831i7rn';
const OTHER_TENANT = 'cjld2cyuq0000t3rmniod1foy';

type CallRequest = {
  method: string;
  params: { name: string; arguments?: unknown };
};
type CallExtra = {
  authInfo?: { scopes?: string[]; extra?: Record<string, unknown> };
};
type CallResult = { content: Array<{ text: string }>; isError?: boolean };
type CallHandler = (
  request: CallRequest,
  extra?: CallExtra,
) => Promise<CallResult>;

const getRequestMethod = (schema: unknown): string | undefined =>
  (schema as { def?: { shape?: { method?: { def?: { values?: string[] } } } } })
    ?.def?.shape?.method?.def?.values?.[0];

/** A mock export that writes `fileCount` memory files + index + manifest to the sink. */
const makeExport = (fileCount: number): { export: jest.Mock } => ({
  export: jest.fn(async (options: { userId: string }, sink: ExportSink) => {
    for (let i = 0; i < fileCount; i += 1)
      await sink.writeFile(`memories/m${i}.md`, `doc ${i}`);
    await sink.writeFile('index.md', '# index');
    await sink.writeFile('manifest.json', '{}');
    return {
      manifest: {
        generator: 'engram',
        filters: { userId: options.userId },
        counts: { total: fileCount, files: fileCount },
      },
      fileCount,
      failed: [],
    };
  }),
});

const mockMemoryService = { recall: jest.fn(), listMemories: jest.fn() };
const mockReindexQueue = {};
const mockConsolidation = {};

async function buildController(
  exportService: unknown,
): Promise<MemoryController> {
  const providers: Provider[] = [
    { provide: MemoryService, useValue: mockMemoryService },
    { provide: ReindexQueueService, useValue: mockReindexQueue },
    { provide: ConsolidationService, useValue: mockConsolidation },
  ];
  if (exportService)
    providers.push({ provide: MemoryExportService, useValue: exportService });
  const module: TestingModule = await Test.createTestingModule({
    controllers: [MemoryController],
    providers,
  }).compile();
  return module.get(MemoryController);
}

const captureDispatch = (t: Tool): CallHandler => {
  const server = new Server(
    { name: 'wiring', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  let captured: CallHandler | undefined;
  jest
    .spyOn(server, 'setRequestHandler')
    .mockImplementation((schema, fn): void => {
      if (getRequestMethod(schema) === 'tools/call')
        captured = fn as unknown as CallHandler;
    });
  registerTools(server, [t], { required: true });
  if (!captured) throw new Error('tools/call handler not registered');
  return captured;
};

describe('export_memories registration + metadata', () => {
  it('is registered, identity-mode, delegable, and scope-gated on memories:read', async () => {
    const controller = await buildController(makeExport(1));
    const t = controller
      .getMcpTools()
      .find((x) => x.name === 'export_memories');
    expect(t).toBeDefined();
    expect(t?.auth ?? 'identity').toBe('identity');
    expect(t?.delegable).toBe(true);
    expect(t?.requiredScope).toBe('memories:read');
  });

  it('is NOT advertised when the export service is absent (lite/memory profile)', async () => {
    const controller = await buildController(null);
    expect(
      controller.getMcpTools().some((x) => x.name === 'export_memories'),
    ).toBe(false);
  });
});

describe('export_memories dispatch (delegation + scope enforcement)', () => {
  const toolFor = async (exportService: unknown): Promise<Tool> => {
    const controller = await buildController(exportService);
    const t = controller
      .getMcpTools()
      .find((x) => x.name === 'export_memories');
    if (!t) throw new Error('export_memories not registered');
    return t;
  };

  it('honours an admin key delegating to another tenant', async () => {
    const exportService = makeExport(1);
    const call = captureDispatch(await toolFor(exportService));
    await call(
      {
        method: 'tools/call',
        params: {
          name: 'export_memories',
          arguments: { userId: OTHER_TENANT },
        },
      },
      { authInfo: { scopes: ['admin'], extra: { userId: KEY_TENANT } } },
    );
    expect(exportService.export).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OTHER_TENANT }),
      expect.anything(),
    );
  });

  it('pins a non-admin memories:read key back to its own tenant', async () => {
    const exportService = makeExport(1);
    const call = captureDispatch(await toolFor(exportService));
    await call(
      {
        method: 'tools/call',
        params: {
          name: 'export_memories',
          arguments: { userId: OTHER_TENANT },
        },
      },
      {
        authInfo: { scopes: ['memories:read'], extra: { userId: KEY_TENANT } },
      },
    );
    expect(exportService.export).toHaveBeenCalledWith(
      expect.objectContaining({ userId: KEY_TENANT }),
      expect.anything(),
    );
  });

  it('rejects a key that lacks memories:read (a memories:write-only key)', async () => {
    const exportService = makeExport(1);
    const call = captureDispatch(await toolFor(exportService));
    const result = await call(
      {
        method: 'tools/call',
        params: { name: 'export_memories', arguments: { userId: KEY_TENANT } },
      },
      {
        authInfo: { scopes: ['memories:write'], extra: { userId: KEY_TENANT } },
      },
    );
    expect(result.isError).toBe(true);
    expect(exportService.export).not.toHaveBeenCalled();
  });

  it('accepts the web download maxInline (2000) through the real input schema', async () => {
    // Regression guard: the web backend sends maxInline=WEB_EXPORT_MAX_INLINE
    // (2000); the tool schema cap must cover it or every web export fails
    // validation at dispatch. Exercises the REAL schema (not a mock).
    const exportService = makeExport(1);
    const call = captureDispatch(await toolFor(exportService));
    const result = await call(
      {
        method: 'tools/call',
        params: {
          name: 'export_memories',
          arguments: { userId: KEY_TENANT, maxInline: 2000 },
        },
      },
      {
        authInfo: { scopes: ['memories:read'], extra: { userId: KEY_TENANT } },
      },
    );
    expect(result.isError).toBeFalsy();
    expect(exportService.export).toHaveBeenCalled();
    expect(JSON.parse(result.content[0]?.text ?? '{}').mode).toBe('inline');
  });
});

describe('export_memories handler (inline vs server-path branch)', () => {
  it('returns documents + manifest inline when at/below maxInline', async () => {
    const controller = await buildController(makeExport(2));
    const res = await controller.exportMemories({
      userId: KEY_TENANT,
      maxInline: 25,
    });
    const payload = JSON.parse(res.content[0]?.text ?? '{}');
    expect(payload.mode).toBe('inline');
    expect(payload.files['memories/m0.md']).toBe('doc 0');
    expect(payload.files['manifest.json']).toBeDefined();
    expect(payload.manifest.generator).toBe('engram');
  });

  it('returns a server path reference (not inline files) when over maxInline', async () => {
    const controller = await buildController(makeExport(3));
    const res = await controller.exportMemories({
      userId: KEY_TENANT,
      maxInline: 0,
    });
    const payload = JSON.parse(res.content[0]?.text ?? '{}');
    expect(payload.mode).toBe('path');
    expect(typeof payload.path).toBe('string');
    expect(payload.files).toBeUndefined();
    expect(payload.manifest.counts.files).toBe(3);
  });

  it('throws a client-facing error when the export service is unavailable', async () => {
    const controller = await buildController(null);
    await expect(
      controller.exportMemories({ userId: KEY_TENANT }),
    ).rejects.toThrow('unavailable');
  });

  it('passes filters through, converting ISO dates to Date objects', async () => {
    const exportService = makeExport(1);
    const controller = await buildController(exportService);
    await controller.exportMemories({
      userId: KEY_TENANT,
      includeStm: true,
      tags: ['decision'],
      scope: 'project:engram',
      type: 'long-term',
      mode: 'single',
      dateFrom: '2026-06-01T00:00:00.000Z',
    });
    expect(exportService.export).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: KEY_TENANT,
        includeStm: true,
        tags: ['decision'],
        scope: 'project:engram',
        type: 'long-term',
        mode: 'single',
        dateFrom: new Date('2026-06-01T00:00:00.000Z'),
      }),
      expect.anything(),
    );
  });
});
