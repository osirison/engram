/**
 * Wiring test for the MCP tool manifest (WP6 T4).
 *
 * TOOL_MANIFEST is the single source of truth shared by the controller (which
 * attaches handlers) and the docs generator (`scripts/gen-mcp-tools.mjs`). This
 * suite proves the controller registers *exactly* the manifest — same tools, in
 * the same order, with the same auth/scope/delegable metadata — so the generated
 * reference cannot silently drift from what the server advertises. It also
 * asserts every manifest schema is a ZodObject, which the generator relies on to
 * emit an input-parameter table.
 */
import { Test, TestingModule } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import { z } from 'zod';
import type { Tool } from '@engram/core';
import { MemoryImportService } from '@engram/memory-import';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { ReindexQueueService } from './reindex-queue.service';
import { ConsolidationService } from './consolidation.service';
import { MemoryExportService } from './export/memory-export.service';
import { TOOL_MANIFEST } from './tools-manifest';

describe('TOOL_MANIFEST ↔ MemoryController.getMcpTools', () => {
  let tools: Tool[];
  let originalProfile: string | undefined;

  beforeAll(async () => {
    originalProfile = process.env.DEPLOYMENT_PROFILE;
    delete process.env.DEPLOYMENT_PROFILE; // enterprise → every tool exposed

    const providers: Provider[] = [
      { provide: MemoryService, useValue: {} },
      { provide: ReindexQueueService, useValue: {} },
      { provide: ConsolidationService, useValue: {} },
      // Provide export + import so their tools are advertised (they are only
      // filtered out when the Postgres-only services are absent).
      { provide: MemoryExportService, useValue: {} },
      { provide: MemoryImportService, useValue: {} },
    ];
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MemoryController],
      providers,
    }).compile();
    tools = module.get<MemoryController>(MemoryController).getMcpTools();
  });

  afterAll(() => {
    if (originalProfile === undefined) delete process.env.DEPLOYMENT_PROFILE;
    else process.env.DEPLOYMENT_PROFILE = originalProfile;
  });

  it('registers exactly the manifest tools, in manifest order', () => {
    expect(tools.map((t) => t.name)).toEqual(TOOL_MANIFEST.map((m) => m.name));
  });

  it('applies each manifest entry’s metadata faithfully', () => {
    for (const entry of TOOL_MANIFEST) {
      const tool = tools.find((t) => t.name === entry.name);
      expect(tool).toBeDefined();
      expect(tool!.description).toBe(entry.description);
      expect(tool!.auth).toBe(entry.auth);
      expect(tool!.requiredScope).toBe(entry.requiredScope);
      expect(tool!.delegable).toBe(entry.delegable);
      // The controller attaches a callable handler for every manifest tool.
      expect(typeof tool!.handler).toBe('function');
    }
  });

  it('every manifest schema is a ZodObject (the generator emits a param table)', () => {
    for (const entry of TOOL_MANIFEST) {
      expect(entry.inputSchema).toBeInstanceOf(z.ZodObject);
    }
  });

  it('admin tools carry no scope; scoped tools are identity-mode', () => {
    for (const entry of TOOL_MANIFEST) {
      if (entry.auth === 'admin') {
        expect(entry.requiredScope).toBeUndefined();
      }
      if (entry.requiredScope) {
        expect(entry.auth).toBeUndefined();
      }
    }
  });
});
