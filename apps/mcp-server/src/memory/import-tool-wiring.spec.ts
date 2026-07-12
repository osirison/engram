/**
 * Wiring test for the `import_agent_memory` MCP tool (WP4 T13). Proves the tool
 * is registered admin-gated, hidden when the (Postgres-only) import service is
 * absent, that the handler enforces the admin token AND the server-side path
 * allowlist (A18 — including on `dryRun`), and that the input schema is
 * `.strict()`. Mirrors export-tool-wiring.spec.ts.
 */
import { Test, TestingModule } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import { MemoryImportService } from '@engram/memory-import';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { ReindexQueueService } from './reindex-queue.service';
import { ConsolidationService } from './consolidation.service';
import { importAgentMemoryToolSchema } from './dto/import-agent-memory.dto';

const KEY_TENANT = 'cjld2cjxh0000qzrmn831i7rn';
const ADMIN_TOKEN = 'test-admin-token-abcdefgh';

const mockMemoryService = { recall: jest.fn(), listMemories: jest.fn() };

function makeImport(): { run: jest.Mock } {
  return {
    run: jest.fn(() =>
      Promise.resolve({
        source: 'markdown',
        path: '/vault',
        userId: KEY_TENANT,
        scope: 'import',
        importBatchId: 'b1',
        dryRun: true,
        parsed: 3,
        created: 0,
        updated: 0,
        skipped: 0,
        mergedIntoExisting: 0,
        secretsSkipped: 0,
        failed: 0,
        links: { resolved: 0, deferred: 0, dangling: 0 },
        secrets: [],
        embeddingCostEstimate: {
          calls: 3,
          approxTokens: 100,
          approxUsd: 0.000002,
          model: 'text-embedding-3-small',
        },
        advisories: [
          'Dry run: no memories, links, or ledger rows were written.',
        ],
      }),
    ),
  };
}

async function buildController(
  importService: unknown,
): Promise<MemoryController> {
  const providers: Provider[] = [
    { provide: MemoryService, useValue: mockMemoryService },
    { provide: ReindexQueueService, useValue: {} },
    { provide: ConsolidationService, useValue: {} },
  ];
  if (importService)
    providers.push({ provide: MemoryImportService, useValue: importService });
  const module: TestingModule = await Test.createTestingModule({
    controllers: [MemoryController],
    providers,
  }).compile();
  return module.get(MemoryController);
}

describe('import_agent_memory registration', () => {
  it('is registered with auth admin when the import service is present', async () => {
    const controller = await buildController(makeImport());
    const tool = controller
      .getMcpTools()
      .find((t) => t.name === 'import_agent_memory');
    expect(tool).toBeDefined();
    expect(tool?.auth).toBe('admin');
  });

  it('is NOT advertised when the import service is absent (lite/memory profile)', async () => {
    const controller = await buildController(null);
    expect(
      controller.getMcpTools().some((t) => t.name === 'import_agent_memory'),
    ).toBe(false);
  });
});

describe('import_agent_memory handler', () => {
  const prevToken = process.env.MCP_ADMIN_TOKEN;
  const prevRoot = process.env.IMPORT_ALLOWED_ROOT;
  // Real directories: `base` holds the allowed root plus an out-of-root file,
  // so the A18 path-allowlist wiring is exercised against the actual fs.
  let base: string;
  let allowedRoot: string;
  let vaultDir: string;
  let outsideFile: string;

  beforeAll(async () => {
    process.env.MCP_ADMIN_TOKEN = ADMIN_TOKEN;
    base = await mkdtemp(join(tmpdir(), 'engram-import-wiring-'));
    allowedRoot = join(base, 'allowed');
    vaultDir = join(allowedRoot, 'vault');
    outsideFile = join(base, 'outside.md');
    await mkdir(vaultDir, { recursive: true });
    await writeFile(join(vaultDir, 'notes.md'), '# notes\n');
    await writeFile(outsideFile, 'not importable\n');
    process.env.IMPORT_ALLOWED_ROOT = allowedRoot;
  });
  afterAll(async () => {
    if (prevToken === undefined) delete process.env.MCP_ADMIN_TOKEN;
    else process.env.MCP_ADMIN_TOKEN = prevToken;
    if (prevRoot === undefined) delete process.env.IMPORT_ALLOWED_ROOT;
    else process.env.IMPORT_ALLOWED_ROOT = prevRoot;
    await rm(base, { recursive: true, force: true });
  });

  it('rejects a wrong admin token', async () => {
    const importService = makeImport();
    const controller = await buildController(importService);
    await expect(
      controller.importAgentMemory({
        adminToken: 'wrong-token-xxxxxxxxxxx',
        source: 'markdown',
        path: '/v',
        userId: KEY_TENANT,
      }),
    ).rejects.toThrow();
    expect(importService.run).not.toHaveBeenCalled();
  });

  it('runs a dry-run import of an in-root path with a valid admin token and returns the summary', async () => {
    const importService = makeImport();
    const controller = await buildController(importService);
    const res = await controller.importAgentMemory({
      adminToken: ADMIN_TOKEN,
      source: 'markdown',
      path: vaultDir,
      userId: KEY_TENANT,
      dryRun: true,
    });
    expect(importService.run).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'markdown',
        path: vaultDir,
        userId: KEY_TENANT,
        dryRun: true,
      }),
    );
    const payload = JSON.parse(res.content[0]?.text ?? '{}');
    expect(payload.parsed).toBe(3);
    expect(payload.dryRun).toBe(true);
  });

  it('accepts an in-root path on a non-dry run', async () => {
    const importService = makeImport();
    const controller = await buildController(importService);
    await controller.importAgentMemory({
      adminToken: ADMIN_TOKEN,
      source: 'markdown',
      path: vaultDir,
      userId: KEY_TENANT,
    });
    expect(importService.run).toHaveBeenCalledWith(
      expect.objectContaining({ path: vaultDir }),
    );
  });

  it('rejects an out-of-root path with an error naming the allowed root (A18)', async () => {
    const importService = makeImport();
    const controller = await buildController(importService);
    await expect(
      controller.importAgentMemory({
        adminToken: ADMIN_TOKEN,
        source: 'markdown',
        path: outsideFile,
        userId: KEY_TENANT,
      }),
    ).rejects.toThrow(/outside the allowed import root/);
    expect(importService.run).not.toHaveBeenCalled();
  });

  it('enforces the path allowlist on dryRun too (A18)', async () => {
    const importService = makeImport();
    const controller = await buildController(importService);
    await expect(
      controller.importAgentMemory({
        adminToken: ADMIN_TOKEN,
        source: 'markdown',
        path: outsideFile,
        userId: KEY_TENANT,
        dryRun: true,
      }),
    ).rejects.toThrow(/outside the allowed import root/);
    expect(importService.run).not.toHaveBeenCalled();
  });

  it('rejects a traversal path that escapes the root (A18)', async () => {
    const importService = makeImport();
    const controller = await buildController(importService);
    await expect(
      controller.importAgentMemory({
        adminToken: ADMIN_TOKEN,
        source: 'markdown',
        path: join(allowedRoot, '..', 'outside.md'),
        userId: KEY_TENANT,
      }),
    ).rejects.toThrow(/outside the allowed import root/);
    expect(importService.run).not.toHaveBeenCalled();
  });

  it('rejects a nonexistent path with a clear error (A18)', async () => {
    const importService = makeImport();
    const controller = await buildController(importService);
    await expect(
      controller.importAgentMemory({
        adminToken: ADMIN_TOKEN,
        source: 'markdown',
        path: join(vaultDir, 'nope'),
        userId: KEY_TENANT,
      }),
    ).rejects.toThrow(/does not exist on the server/);
    expect(importService.run).not.toHaveBeenCalled();
  });
});

describe('importAgentMemoryToolSchema', () => {
  it('rejects unknown keys (.strict)', () => {
    const parsed = importAgentMemoryToolSchema.safeParse({
      adminToken: ADMIN_TOKEN,
      source: 'markdown',
      path: '/v',
      userId: KEY_TENANT,
      bogus: true,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an invalid source', () => {
    expect(
      importAgentMemoryToolSchema.safeParse({
        adminToken: ADMIN_TOKEN,
        source: 'notatool',
        path: '/v',
        userId: KEY_TENANT,
      }).success,
    ).toBe(false);
  });
});
