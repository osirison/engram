/* eslint-disable turbo/no-undeclared-env-vars -- test swaps process.env.HOME to exercise includeGlobal */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GEMINI_ADAPTER_VERSION, GeminiAdapter } from './gemini.adapter.js';
import type { ImportedFact } from '../ir/types.js';
import type { ParseOptions } from '../ir/source-adapter.interface.js';

const REPO_DIR = fileURLToPath(new URL('./__fixtures__/gemini/repo', import.meta.url));
const REPO_FILE = fileURLToPath(new URL('./__fixtures__/gemini/repo/GEMINI.md', import.meta.url));
const HOME_DIR = fileURLToPath(new URL('./__fixtures__/gemini/home', import.meta.url));

const OPTS: ParseOptions = {
  importBatchId: 'batch-1',
  importedAt: '2026-07-06T00:00:00.000Z',
  host: 'test-host',
};

function byKey(facts: ImportedFact[], sourceKey: string): ImportedFact {
  const fact = facts.find((f) => f.sourceKey === sourceKey);
  expect(fact, `fact ${sourceKey}`).toBeDefined();
  return fact as ImportedFact;
}

function locators(fact: ImportedFact): string[] {
  return fact.links.map((l) => l.targetLocator);
}

describe('GeminiAdapter.detect', () => {
  it('detects a directory containing GEMINI.md files', async () => {
    expect(await new GeminiAdapter().detect(REPO_DIR)).toBe(true);
  });

  it('detects a path that IS a GEMINI.md file', async () => {
    expect(await new GeminiAdapter().detect(REPO_FILE)).toBe(true);
  });

  it('returns false for a directory with no (non-hidden) GEMINI.md', async () => {
    // HOME_DIR only holds a hidden `.gemini/GEMINI.md`, which the walker skips.
    expect(await new GeminiAdapter().detect(HOME_DIR)).toBe(false);
  });
});

describe('GeminiAdapter.parse (repo + nested)', () => {
  it('produces per-H2-section facts with level tags and anchors', async () => {
    const ir = await new GeminiAdapter().parse(REPO_DIR, OPTS);

    expect(ir.sourceTool).toBe('gemini');
    expect(ir.rootPath).toBe(REPO_DIR);

    expect(ir.facts.map((f) => f.sourceKey)).toEqual([
      'gemini:GEMINI.md#overview',
      'gemini:GEMINI.md#build-and-test',
      'gemini:GEMINI.md#coding-style',
      'gemini:sub/GEMINI.md#overview',
      'gemini:sub/GEMINI.md#database-layer',
    ]);

    for (const fact of ir.facts) {
      expect(fact.tags).toContain('gemini');
      expect(fact.tags).toContain('instructions');
    }
  });

  it('tags repo-root facts level:repo and nested facts level:nested', async () => {
    const ir = await new GeminiAdapter().parse(REPO_DIR, OPTS);

    expect(byKey(ir.facts, 'gemini:GEMINI.md#build-and-test').tags).toContain('level:repo');
    const nested = byKey(ir.facts, 'gemini:sub/GEMINI.md#database-layer');
    expect(nested.tags).toContain('level:nested');
    expect(nested.sourcePath).toBe('sub/GEMINI.md');
    expect(nested.anchor).toBe('database-layer');
  });

  it('extracts a relative markdown link as a path: locator', async () => {
    const ir = await new GeminiAdapter().parse(REPO_DIR, OPTS);
    const build = byKey(ir.facts, 'gemini:GEMINI.md#build-and-test');
    expect(locators(build)).toContain('path:docs/contributing.md');
  });

  it('extracts @import / bare @file.md include directives as md-relative links', async () => {
    const ir = await new GeminiAdapter().parse(REPO_DIR, OPTS);

    // Bare Gemini form `@shared/build-rules.md` in the Build and Test section.
    const build = byKey(ir.facts, 'gemini:GEMINI.md#build-and-test');
    const buildImport = build.links.find((l) => l.targetLocator === 'path:shared/build-rules.md');
    expect(buildImport).toBeDefined();
    expect(buildImport?.kind).toBe('md-relative');
    expect(buildImport?.relType).toBe('relates-to');

    // Keyword form `@import ./shared/style-rules.md` in the Coding Style section.
    const style = byKey(ir.facts, 'gemini:GEMINI.md#coding-style');
    expect(locators(style)).toContain('path:shared/style-rules.md');
  });

  it('stamps provenance from ParseOptions + adapter version', async () => {
    const ir = await new GeminiAdapter().parse(REPO_DIR, OPTS);
    expect(ir.provenance).toEqual({
      importedAt: OPTS.importedAt,
      importBatchId: OPTS.importBatchId,
      host: OPTS.host,
      adapterVersion: GEMINI_ADAPTER_VERSION,
    });
  });
});

describe('GeminiAdapter.parse (single file)', () => {
  it('treats an explicit GEMINI.md file as the repo-level file', async () => {
    const ir = await new GeminiAdapter().parse(REPO_FILE, OPTS);
    expect(ir.rootPath).toBe(REPO_DIR);
    const first = ir.facts[0];
    expect(first).toBeDefined();
    expect(first?.sourcePath).toBe('GEMINI.md');
    expect(first?.tags).toContain('level:repo');
    // Only the single file is parsed — no nested facts.
    expect(ir.facts.every((f) => f.sourcePath === 'GEMINI.md')).toBe(true);
  });
});

describe('GeminiAdapter.parse (includeGlobal)', () => {
  it('includes ~/.gemini/GEMINI.md only when opts.includeGlobal is set', async () => {
    const prevHome = process.env.HOME;
    process.env.HOME = HOME_DIR;
    try {
      const without = await new GeminiAdapter().parse(REPO_DIR, OPTS);
      expect(without.facts.some((f) => f.tags.includes('level:global'))).toBe(false);

      const withGlobal = await new GeminiAdapter().parse(REPO_DIR, {
        ...OPTS,
        includeGlobal: true,
      });
      expect(withGlobal.facts.some((f) => f.tags.includes('level:global'))).toBe(true);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
    }
  });
});
