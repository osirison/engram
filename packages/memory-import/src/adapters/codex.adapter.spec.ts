import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { posix, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect } from 'vitest';
import { CodexAdapter, CODEX_ADAPTER_VERSION } from './codex.adapter.js';
import type { ParseOptions } from '../ir/source-adapter.interface.js';
import type { ImportedFact } from '../ir/types.js';

const fixture = (rel: string): string =>
  fileURLToPath(new URL(`./__fixtures__/codex/${rel}`, import.meta.url));

const REPO = fixture('repo');
const ROOT_FILE = fixture('repo/AGENTS.md');
const GLOBAL_FILE = fixture('home/.codex/AGENTS.md');

const OPTS: ParseOptions = {
  importBatchId: 'batch-1',
  importedAt: '2026-07-06T00:00:00.000Z',
  host: 'test-host',
};

const byKey = (facts: ImportedFact[], key: string): ImportedFact | undefined =>
  facts.find((f) => f.sourceKey === key);

describe('CodexAdapter.detect', () => {
  it('returns true for a directory containing a root AGENTS.md', async () => {
    expect(await new CodexAdapter().detect(REPO)).toBe(true);
  });

  it('returns true when the path IS an AGENTS.md file', async () => {
    expect(await new CodexAdapter().detect(ROOT_FILE)).toBe(true);
  });

  it('returns false for a directory with no AGENTS.md anywhere', async () => {
    const empty = await fs.mkdtemp(join(tmpdir(), 'codex-detect-'));
    try {
      expect(await new CodexAdapter().detect(empty)).toBe(false);
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });
});

describe('CodexAdapter.parse', () => {
  it('parses root + nested AGENTS.md into per-section facts with level tags', async () => {
    const ir = await new CodexAdapter().parse(REPO, OPTS);

    expect(ir.sourceTool).toBe('codex');
    expect(ir.rootPath).toBe(REPO);
    expect(ir.provenance.adapterVersion).toBe(CODEX_ADAPTER_VERSION);
    expect(ir.provenance.importBatchId).toBe('batch-1');
    expect(ir.provenance.host).toBe('test-host');

    // Root file → three H2 chunks, all level:repo.
    const overview = byKey(ir.facts, 'codex:AGENTS.md#overview');
    const build = byKey(ir.facts, 'codex:AGENTS.md#build-and-test');
    const style = byKey(ir.facts, 'codex:AGENTS.md#coding-style');
    expect(overview).toBeDefined();
    expect(build).toBeDefined();
    expect(style).toBeDefined();
    for (const f of [overview, build, style]) {
      expect(f?.tags).toEqual(
        expect.arrayContaining(['codex', 'agents-md', 'instructions', 'level:repo'])
      );
      expect(f?.tags).not.toContain('level:nested');
    }
    expect(overview?.title).toBe('Example Repo Agent Instructions');
    expect(build?.anchor).toBe('build-and-test');
  });

  it('extracts relative markdown links as path: locators', async () => {
    const ir = await new CodexAdapter().parse(REPO, OPTS);
    const build = byKey(ir.facts, 'codex:AGENTS.md#build-and-test');
    const style = byKey(ir.facts, 'codex:AGENTS.md#coding-style');

    const buildLinks = build?.links.map((l) => l.targetLocator) ?? [];
    expect(buildLinks).toContain('path:README.md');
    expect(build?.links.every((l) => l.kind === 'md-relative')).toBe(true);
    expect(build?.links.every((l) => l.relType === 'relates-to')).toBe(true);

    const styleLinks = style?.links.map((l) => l.targetLocator) ?? [];
    expect(styleLinks).toContain('path:docs/style.md');
  });

  it('tags nested AGENTS.md facts with level:nested and a nested sourcePath', async () => {
    const ir = await new CodexAdapter().parse(REPO, OPTS);
    const nested = ir.facts.filter((f) => f.sourcePath === 'pkg/AGENTS.md');
    expect(nested.length).toBeGreaterThanOrEqual(2);
    for (const f of nested) {
      expect(f.tags).toContain('level:nested');
      expect(f.tags).not.toContain('level:repo');
      expect(f.sourceKey.startsWith('codex:pkg/AGENTS.md#')).toBe(true);
    }
    expect(byKey(ir.facts, 'codex:pkg/AGENTS.md#local-conventions')).toBeDefined();
  });

  it('skips AGENTS.md inside node_modules while keeping real nested files', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'codex-skip-'));
    try {
      const body = `# Heading\n\n${'padding to clear the fragment threshold. '.repeat(8)}`;
      await fs.writeFile(join(root, 'AGENTS.md'), body, 'utf8');
      await fs.mkdir(join(root, 'sub'), { recursive: true });
      await fs.writeFile(join(root, 'sub', 'AGENTS.md'), body, 'utf8');
      await fs.mkdir(join(root, 'node_modules', 'dep'), { recursive: true });
      await fs.writeFile(join(root, 'node_modules', 'dep', 'AGENTS.md'), body, 'utf8');

      const ir = await new CodexAdapter().parse(root, OPTS);
      const paths = new Set(ir.facts.map((f) => f.sourcePath));
      expect(paths.has('AGENTS.md')).toBe(true);
      expect(paths.has('sub/AGENTS.md')).toBe(true);
      expect(ir.facts.some((f) => f.sourcePath.includes('node_modules'))).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('parses a single AGENTS.md file path as a repo-level file', async () => {
    const ir = await new CodexAdapter().parse(ROOT_FILE, OPTS);
    // rootPath collapses to the file's dirname; sourcePath is the basename.
    expect(ir.rootPath).toBe(posix.dirname(REPO.split('\\').join('/') + '/AGENTS.md'));
    expect(ir.facts.every((f) => f.sourcePath === 'AGENTS.md')).toBe(true);
    expect(ir.facts.every((f) => f.tags.includes('level:repo'))).toBe(true);
    expect(ir.facts.some((f) => f.sourcePath.includes('pkg/'))).toBe(false);
  });

  it('omits the global AGENTS.md unless includeGlobal is set', async () => {
    const adapter = new CodexAdapter({ globalAgentsPath: GLOBAL_FILE });

    const without = await adapter.parse(REPO, OPTS);
    expect(without.facts.some((f) => f.tags.includes('level:global'))).toBe(false);

    const withGlobal = await adapter.parse(REPO, { ...OPTS, includeGlobal: true });
    const globalFacts = withGlobal.facts.filter((f) => f.tags.includes('level:global'));
    expect(globalFacts.length).toBeGreaterThanOrEqual(1);
    expect(globalFacts.every((f) => f.sourceTool === 'codex')).toBe(true);
  });
});
