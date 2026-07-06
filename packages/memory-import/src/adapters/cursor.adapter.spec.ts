import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { CursorAdapter, CURSOR_ADAPTER_VERSION } from './cursor.adapter.js';
import type { ImportedFact } from '../ir/types.js';

const FIXTURE_ROOT = fileURLToPath(new URL('./__fixtures__/cursor', import.meta.url));
const ADAPTERS_DIR = fileURLToPath(new URL('.', import.meta.url));

const OPTS = {
  importBatchId: 'batch-1',
  importedAt: '2026-07-06T00:00:00.000Z',
  host: 'test-host',
};

function byKey(facts: ImportedFact[], key: string): ImportedFact | undefined {
  return facts.find((f) => f.sourceKey === key);
}

describe('CursorAdapter.detect', () => {
  const adapter = new CursorAdapter();

  it('is true for a project root containing .cursor/rules + .cursorrules', async () => {
    expect(await adapter.detect(FIXTURE_ROOT)).toBe(true);
  });

  it('is true for a single .mdc rule file', async () => {
    const mdc = fileURLToPath(
      new URL('./__fixtures__/cursor/.cursor/rules/global.mdc', import.meta.url)
    );
    expect(await adapter.detect(mdc)).toBe(true);
  });

  it('is true for a single .cursorrules file', async () => {
    const legacy = fileURLToPath(new URL('./__fixtures__/cursor/.cursorrules', import.meta.url));
    expect(await adapter.detect(legacy)).toBe(true);
  });

  it('is false for an unrelated directory', async () => {
    expect(await adapter.detect(ADAPTERS_DIR)).toBe(false);
  });
});

describe('CursorAdapter.parse (directory mode)', () => {
  const adapter = new CursorAdapter();

  it('sets IR-level provenance and POSIX-relative rootPath', async () => {
    const ir = await adapter.parse(FIXTURE_ROOT, OPTS);
    expect(ir.sourceTool).toBe('cursor');
    expect(ir.rootPath).toBe(FIXTURE_ROOT);
    expect(ir.provenance).toMatchObject({
      importBatchId: 'batch-1',
      importedAt: '2026-07-06T00:00:00.000Z',
      host: 'test-host',
      adapterVersion: CURSOR_ADAPTER_VERSION,
    });
    // Every fact's sourcePath is repo-relative POSIX (never absolute / backslash).
    for (const fact of ir.facts) {
      expect(fact.sourcePath.startsWith('/')).toBe(false);
      expect(fact.sourcePath).not.toContain('\\');
    }
  });

  it('.mdc with globs → one atomic fact, frontmatter preserved, globs-scoped tag', async () => {
    const ir = await adapter.parse(FIXTURE_ROOT, OPTS);
    const fact = byKey(ir.facts, 'cursor:.cursor/rules/typescript.mdc');
    expect(fact).toBeDefined();
    expect(fact?.tags).toEqual(expect.arrayContaining(['cursor', 'rules', 'globs-scoped']));
    expect(fact?.tags).not.toContain('always-apply');
    expect(fact?.frontmatter).toMatchObject({
      description: 'TypeScript conventions for this repo',
      globs: ['src/**/*.ts', 'src/**/*.tsx'],
      alwaysApply: false,
    });
    // Frontmatter is stripped from persisted content.
    expect(fact?.content).not.toContain('description:');
  });

  it('.mdc body wikilink is extracted as a slug: link', async () => {
    const ir = await adapter.parse(FIXTURE_ROOT, OPTS);
    const fact = byKey(ir.facts, 'cursor:.cursor/rules/typescript.mdc');
    const locators = fact?.links.map((l) => l.targetLocator) ?? [];
    expect(locators).toContain('slug:coding-standards');
  });

  it('.mdc @file references become md-relative path: links (scopes/decorators excluded)', async () => {
    const ir = await adapter.parse(FIXTURE_ROOT, OPTS);
    const fact = byKey(ir.facts, 'cursor:.cursor/rules/typescript.mdc');
    const atLinks = (fact?.links ?? []).filter((l) => l.kind === 'md-relative');
    const locators = atLinks.map((l) => l.targetLocator);
    expect(locators).toContain('path:src/utils/logger.ts');
    expect(locators).toContain('path:src/templates/service-template.ts');
    // Every @file link carries the raw `@...` target + relates-to rel type.
    for (const link of atLinks) {
      expect(link.rawTarget.startsWith('@')).toBe(true);
      expect(link.relType).toBe('relates-to');
    }
    // npm scope + decorator tokens must NOT be treated as file links.
    const allLocators = (fact?.links ?? []).map((l) => l.targetLocator).join(' ');
    expect(allLocators).not.toContain('memory-interchange');
    expect(allLocators).not.toContain('Deprecated');
  });

  it('.mdc with alwaysApply:true + empty globs → always-apply tag, no globs-scoped', async () => {
    const ir = await adapter.parse(FIXTURE_ROOT, OPTS);
    const fact = byKey(ir.facts, 'cursor:.cursor/rules/global.mdc');
    expect(fact).toBeDefined();
    expect(fact?.tags).toEqual(expect.arrayContaining(['cursor', 'rules', 'always-apply']));
    expect(fact?.tags).not.toContain('globs-scoped');
    expect(fact?.frontmatter).toMatchObject({ alwaysApply: true });
    expect(fact?.frontmatter?.['globs']).toBeNull();
    expect(fact?.links.map((l) => l.targetLocator)).toContain('slug:security-baseline');
  });

  it('.cursorrules (legacy) → split into anchored facts with cursor/rules tags', async () => {
    const ir = await adapter.parse(FIXTURE_ROOT, OPTS);
    const legacyFacts = ir.facts.filter((f) => f.sourcePath === '.cursorrules');
    expect(legacyFacts.length).toBeGreaterThan(1);
    const keys = legacyFacts.map((f) => f.sourceKey);
    expect(keys).toContain('cursor:.cursorrules#formatting-conventions');
    expect(keys).toContain('cursor:.cursorrules#testing-policy');
    for (const fact of legacyFacts) {
      expect(fact.tags).toEqual(['cursor', 'rules']);
      expect(fact.frontmatter).toBeUndefined();
    }
  });
});

describe('CursorAdapter.parse (single-file mode)', () => {
  const adapter = new CursorAdapter();

  it('collapses rootPath to the file dirname and sourcePath to the basename', async () => {
    const mdc = fileURLToPath(
      new URL('./__fixtures__/cursor/.cursor/rules/typescript.mdc', import.meta.url)
    );
    const ir = await adapter.parse(mdc, OPTS);
    expect(ir.facts).toHaveLength(1);
    const [fact] = ir.facts;
    expect(fact?.sourcePath).toBe('typescript.mdc');
    expect(fact?.sourceKey).toBe('cursor:typescript.mdc');
    expect(fact?.tags).toEqual(expect.arrayContaining(['cursor', 'rules', 'globs-scoped']));
  });
});
