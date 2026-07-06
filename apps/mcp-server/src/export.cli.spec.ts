import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, buildExportOptions, runExport } from './export.cli';
import { MemoryExportService } from './memory/export/memory-export.service';
import { DirectorySink } from './memory/export/directory-sink';

describe('export CLI parseArgs', () => {
  it('parses all flags with a repeatable --tag', () => {
    const args = parseArgs([
      '--user',
      'qp',
      '--out',
      './vault',
      '--include-stm',
      '--tag',
      'architecture',
      '--tag',
      'decision',
      '--scope',
      'project:engram',
      '--type',
      'long-term',
      '--from',
      '2026-01-01',
      '--to',
      '2026-12-31',
      '--single',
      '--deterministic',
    ]);
    expect(args).toEqual({
      userId: 'qp',
      out: './vault',
      includeStm: true,
      tags: ['architecture', 'decision'],
      scope: 'project:engram',
      type: 'long-term',
      from: '2026-01-01',
      to: '2026-12-31',
      single: true,
      deterministic: true,
    });
  });

  it('applies defaults when flags are omitted', () => {
    const args = parseArgs(['--user', 'qp']);
    expect(args).toMatchObject({
      userId: 'qp',
      out: './engram-export',
      includeStm: false,
      tags: [],
      single: false,
      deterministic: false,
    });
    expect(args.type).toBeUndefined();
  });

  it('ignores an unknown --type value', () => {
    expect(
      parseArgs(['--user', 'qp', '--type', 'medium-term']).type,
    ).toBeUndefined();
  });
});

describe('export CLI buildExportOptions', () => {
  it('throws when --user is missing', () => {
    expect(() => buildExportOptions(parseArgs([]))).toThrow('--user');
  });

  it('maps --single to mode:single and parses ISO dates', () => {
    const opts = buildExportOptions(
      parseArgs(['--user', 'qp', '--single', '--from', '2026-06-01']),
    );
    expect(opts.mode).toBe('single');
    expect(opts.dateFrom).toEqual(new Date('2026-06-01'));
  });

  it('throws on an invalid ISO date', () => {
    expect(() =>
      buildExportOptions(parseArgs(['--user', 'qp', '--from', 'not-a-date'])),
    ).toThrow('--from');
  });

  it('omits absent optional filters', () => {
    const opts = buildExportOptions(parseArgs(['--user', 'qp']));
    expect(opts).toEqual({
      userId: 'qp',
      includeStm: false,
      mode: 'multi',
      deterministic: false,
    });
  });
});

// ---- wiring: CLI runExport → real service → DirectorySink → disk ----------

const ltmMemory = (id: string): Record<string, unknown> => ({
  id,
  userId: 'qp',
  type: 'long-term',
  content: `Memory ${id}`,
  tags: ['decision'],
  scope: null,
  organizationId: null,
  metadata: null,
  createdAt: new Date('2026-06-01T10:00:00.000Z'),
  updatedAt: new Date('2026-06-01T10:00:00.000Z'),
  expiresAt: null,
  embedding: [],
  version: 1,
});

describe('export CLI wiring (runExport → DirectorySink → disk)', () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'engram-export-'));
  });
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it('writes a browsable vault to disk with index + manifest', async () => {
    const ltm = {
      list: jest.fn().mockResolvedValue({
        items: [ltmMemory('claaa1'), ltmMemory('clbbb2')],
        totalCount: 2,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    };
    const service = new MemoryExportService(ltm as never);
    const args = parseArgs([
      '--user',
      'qp',
      '--out',
      outDir,
      '--deterministic',
    ]);

    const result = await runExport(service, args);

    expect(result.manifest.counts.total).toBe(2);
    const rootEntries = (await readdir(outDir)).sort();
    expect(rootEntries).toEqual(['index.md', 'manifest.json', 'memories']);
    const memoryFiles = (await readdir(join(outDir, 'memories'))).sort();
    expect(memoryFiles).toEqual([
      'memory-claaa1--claaa1.md',
      'memory-clbbb2--clbbb2.md',
    ]);
    const manifest = JSON.parse(
      await readFile(join(outDir, 'manifest.json'), 'utf8'),
    );
    expect(manifest.generator).toBe('engram');
    const doc = await readFile(
      join(outDir, 'memories', 'memory-claaa1--claaa1.md'),
      'utf8',
    );
    expect(doc).toContain('id: claaa1');
  });
});

describe('DirectorySink', () => {
  let outDir: string;
  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'engram-sink-'));
  });
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it('creates parent directories on demand', async () => {
    const sink = new DirectorySink(outDir);
    await sink.writeFile('memories/nested/a.md', 'hello');
    expect(await readFile(join(outDir, 'memories/nested/a.md'), 'utf8')).toBe(
      'hello',
    );
  });

  it('refuses to write outside the export root', async () => {
    const sink = new DirectorySink(outDir);
    await expect(sink.writeFile('../escape.md', 'nope')).rejects.toThrow(
      'outside export root',
    );
  });
});
