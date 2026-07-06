import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CopilotAdapter, COPILOT_ADAPTER_VERSION } from './copilot.adapter.js';
import type { ImportedFact } from '../ir/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(HERE, '__fixtures__', 'copilot');

const OPTS = {
  importBatchId: 'batch-1',
  importedAt: '2026-07-06T00:00:00.000Z',
  host: 'test-host',
};

function byKeyIncludes(facts: ImportedFact[], needle: string): ImportedFact[] {
  return facts.filter((f) => f.sourceKey.includes(needle));
}

describe('CopilotAdapter.detect', () => {
  const adapter = new CopilotAdapter();

  it('detects a repo dir with the .github Copilot layout', async () => {
    expect(await adapter.detect(FIXTURE_ROOT)).toBe(true);
  });

  it('detects a single *.instructions.md file passed directly', async () => {
    const file = join(
      FIXTURE_ROOT,
      '.github',
      'instructions',
      'one-with-frontmatter.instructions.md'
    );
    expect(await adapter.detect(file)).toBe(true);
  });

  it('detects a single copilot-instructions.md file passed directly', async () => {
    const file = join(FIXTURE_ROOT, '.github', 'copilot-instructions.md');
    expect(await adapter.detect(file)).toBe(true);
  });

  it('detects a repo dir with only a .github/instructions/ directory', async () => {
    const scopedOnly = join(HERE, '__fixtures__', 'copilot-scoped-only');
    expect(await adapter.detect(scopedOnly)).toBe(true);
  });

  it('returns false for an unrelated directory', async () => {
    expect(await adapter.detect(HERE)).toBe(false);
  });
});

describe('CopilotAdapter.parse', () => {
  const adapter = new CopilotAdapter();

  it('stamps IR metadata and posix-relative source paths', async () => {
    const ir = await adapter.parse(FIXTURE_ROOT, OPTS);
    expect(ir.sourceTool).toBe('copilot');
    expect(ir.rootPath).toBe(FIXTURE_ROOT);
    expect(ir.provenance).toMatchObject({
      importBatchId: 'batch-1',
      importedAt: '2026-07-06T00:00:00.000Z',
      host: 'test-host',
      adapterVersion: COPILOT_ADAPTER_VERSION,
    });
    for (const fact of ir.facts) {
      expect(fact.sourcePath.startsWith('.github/')).toBe(true);
      expect(fact.sourcePath.includes('\\')).toBe(false);
      expect(fact.tags).toEqual(expect.arrayContaining(['copilot', 'instructions']));
    }
  });

  it('chunks the repo-wide file into per-section facts with relative md links', async () => {
    const ir = await adapter.parse(FIXTURE_ROOT, OPTS);
    const repoFacts = byKeyIncludes(ir.facts, 'copilot:.github/copilot-instructions.md');
    // preamble overview + Build + Testing.
    expect(repoFacts.length).toBeGreaterThanOrEqual(3);
    const anchors = repoFacts.map((f) => f.anchor);
    expect(anchors).toEqual(expect.arrayContaining(['overview', 'build', 'testing']));
    for (const f of repoFacts) {
      expect(f.tags).toContain('instructions');
    }
    // Relative md links resolve against the .github dir up to the repo root.
    const overview = repoFacts.find((f) => f.anchor === 'overview');
    const locators = overview?.links.map((l) => l.targetLocator) ?? [];
    expect(locators).toEqual(expect.arrayContaining(['path:AGENTS.md', 'path:README.md']));
  });

  it('imports a scoped file WITH applyTo as one fact, preserving frontmatter + deriving a tag', async () => {
    const ir = await adapter.parse(FIXTURE_ROOT, OPTS);
    const scoped = byKeyIncludes(ir.facts, 'one-with-frontmatter.instructions.md');
    expect(scoped).toHaveLength(1);
    const fact = scoped[0];
    expect(fact?.sourceKey).toBe(
      'copilot:.github/instructions/one-with-frontmatter.instructions.md'
    );
    expect(fact?.anchor).toBeUndefined();
    expect(fact?.frontmatter).toMatchObject({
      description: 'Rules for editing TypeScript sources in this project.',
      name: 'typescript-sources',
      applyTo: 'src/**/*.ts',
    });
    expect(fact?.tags).toEqual(
      expect.arrayContaining(['copilot', 'instructions', 'applies:src-ts'])
    );
    // Relative md link from .github/instructions/ up to docs/guide.md.
    const locators = fact?.links.map((l) => l.targetLocator) ?? [];
    expect(locators).toContain('path:docs/guide.md');
  });

  it('imports a scoped file WITHOUT frontmatter as one fact, no crash, no applies tag', async () => {
    const ir = await adapter.parse(FIXTURE_ROOT, OPTS);
    const scoped = byKeyIncludes(ir.facts, 'one-without.instructions.md');
    expect(scoped).toHaveLength(1);
    const fact = scoped[0];
    expect(fact?.frontmatter).toBeUndefined();
    expect(fact?.tags).toEqual(['copilot', 'instructions']);
    expect(fact?.tags.some((t) => t.startsWith('applies:'))).toBe(false);
  });

  it('parses a single scoped file directly (rootPath = dirname, sourcePath = basename)', async () => {
    const file = join(
      FIXTURE_ROOT,
      '.github',
      'instructions',
      'one-with-frontmatter.instructions.md'
    );
    const ir = await adapter.parse(file, OPTS);
    expect(ir.rootPath).toBe(join(FIXTURE_ROOT, '.github', 'instructions'));
    expect(ir.facts).toHaveLength(1);
    expect(ir.facts[0]?.sourceKey).toBe('copilot:one-with-frontmatter.instructions.md');
    expect(ir.facts[0]?.tags).toContain('applies:src-ts');
  });

  it('omits host from provenance when not supplied', async () => {
    const ir = await adapter.parse(FIXTURE_ROOT, {
      importBatchId: 'b',
      importedAt: OPTS.importedAt,
    });
    expect(ir.provenance.host).toBeUndefined();
  });
});
