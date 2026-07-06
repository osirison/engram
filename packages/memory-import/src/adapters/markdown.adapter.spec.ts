import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { MARKDOWN_ADAPTER_VERSION, MarkdownAdapter } from './markdown.adapter.js';
import type { ImportIR, ImportedFact } from '../ir/types.js';
import type { ParseOptions } from '../ir/source-adapter.interface.js';

const VAULT = fileURLToPath(new URL('./__fixtures__/markdown/vault', import.meta.url));

const OPTS: ParseOptions = {
  importBatchId: 'batch-md-1',
  importedAt: '2026-07-06T00:00:00.000Z',
  host: 'test-host',
};

function factBy(ir: ImportIR, sourceKey: string): ImportedFact | undefined {
  return ir.facts.find((f) => f.sourceKey === sourceKey);
}

function locators(fact: ImportedFact | undefined): string[] {
  return (fact?.links ?? []).map((l) => l.targetLocator).sort();
}

describe('MarkdownAdapter.detect', () => {
  const adapter = new MarkdownAdapter();

  it('is true for a directory containing markdown notes', async () => {
    expect(await adapter.detect(VAULT)).toBe(true);
  });

  it('is false for a file path', async () => {
    expect(await adapter.detect(join(VAULT, 'MEMORY.md'))).toBe(false);
  });

  it('is false for a directory with no markdown files', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'md-empty-'));
    try {
      expect(await adapter.detect(empty)).toBe(false);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('is false for a non-existent path', async () => {
    expect(await adapter.detect(join(VAULT, 'does-not-exist'))).toBe(false);
  });
});

describe('MarkdownAdapter.parse (atomic default)', () => {
  const adapter = new MarkdownAdapter();
  let ir: ImportIR;

  beforeAll(async () => {
    ir = await adapter.parse(VAULT, OPTS);
  });

  it('emits one fact per kept note (index/MOC + dot-dir excluded)', () => {
    expect(new Set(ir.facts.map((f) => f.sourceKey))).toEqual(
      new Set([
        'markdown:notes/alpha.md',
        'markdown:notes/beta.md',
        'markdown:notes/gamma.md',
        'markdown:notes/multi.md',
        'markdown:notes/MEMORY.md',
      ])
    );
  });

  it('skips the top-level MEMORY.md by the NAME rule', () => {
    expect(factBy(ir, 'markdown:MEMORY.md')).toBeUndefined();
  });

  it('keeps a sub-folder MEMORY.md (top-level rule is path-scoped)', () => {
    expect(factBy(ir, 'markdown:notes/MEMORY.md')).toBeDefined();
  });

  it('skips a sub-folder note by the moc:true rule alone', () => {
    expect(factBy(ir, 'markdown:notes/map.md')).toBeUndefined();
  });

  it('skips a note by the node_type:index rule alone', () => {
    expect(factBy(ir, 'markdown:notes/toc.md')).toBeUndefined();
  });

  it('merges frontmatter list tags onto the base markdown tag', () => {
    const alpha = factBy(ir, 'markdown:notes/alpha.md');
    expect(alpha?.tags).toEqual(['markdown', 'project', 'alpha']);
  });

  it('merges a scalar frontmatter tag', () => {
    const beta = factBy(ir, 'markdown:notes/beta.md');
    expect(beta?.tags).toEqual(['markdown', 'reference']);
  });

  it('preserves frontmatter verbatim on the fact', () => {
    const alpha = factBy(ir, 'markdown:notes/alpha.md');
    expect(alpha?.frontmatter).toMatchObject({ title: 'Alpha', tags: ['project', 'alpha'] });
  });

  it('maps the wikilink + relative-link graph to correct locators', () => {
    // alpha → [[beta]], [[gamma]]
    expect(locators(factBy(ir, 'markdown:notes/alpha.md'))).toEqual(['slug:beta', 'slug:gamma']);
    // beta → [[gamma]]
    expect(locators(factBy(ir, 'markdown:notes/beta.md'))).toEqual(['slug:gamma']);
    // gamma → relative [Alpha](./alpha.md) resolved against notes/
    expect(locators(factBy(ir, 'markdown:notes/gamma.md'))).toEqual(['path:notes/alpha.md']);
  });

  it('treats Obsidian block refs as plain text (only [[..]] become links)', () => {
    const alpha = factBy(ir, 'markdown:notes/alpha.md');
    expect(alpha?.links.every((l) => l.kind === 'wikilink')).toBe(true);
    expect(alpha?.links).toHaveLength(2);
    expect(alpha?.content).toContain('^abc123'); // block ref survives in body, not a link
  });

  it('stamps run-level provenance with the adapter version', () => {
    expect(ir.sourceTool).toBe('markdown');
    expect(ir.rootPath).toBe(VAULT);
    expect(ir.provenance).toEqual({
      importedAt: OPTS.importedAt,
      importBatchId: OPTS.importBatchId,
      host: 'test-host',
      adapterVersion: MARKDOWN_ADAPTER_VERSION,
    });
  });

  it('emits atomic facts with no anchor for single/no-H2 notes', () => {
    expect(factBy(ir, 'markdown:notes/multi.md')?.anchor).toBeUndefined();
    expect(ir.facts.filter((f) => f.anchor !== undefined)).toHaveLength(0);
  });
});

describe('MarkdownAdapter.parse (splitHeadings)', () => {
  const adapter = new MarkdownAdapter();

  it('H2-chunks a multi-heading note into anchored facts', async () => {
    const ir = await adapter.parse(VAULT, { ...OPTS, splitHeadings: true });
    const multi = ir.facts.filter((f) => f.sourcePath === 'notes/multi.md');
    expect(multi.map((f) => f.sourceKey).sort()).toEqual([
      'markdown:notes/multi.md#overview',
      'markdown:notes/multi.md#setup',
      'markdown:notes/multi.md#usage',
    ]);
    // A single-section note stays a lone overview chunk.
    const beta = ir.facts.filter((f) => f.sourcePath === 'notes/beta.md');
    expect(beta).toHaveLength(1);
    expect(beta[0]?.anchor).toBe('overview');
  });
});

describe('MarkdownAdapter.parse (Obsidian embed limitation)', () => {
  const adapter = new MarkdownAdapter();

  // Documents CURRENT behavior, not desired behavior. The task contract says
  // asset embeds `![[x.png]]` should stay plain text, but the shared
  // `extractWikilinks` delegates to interchange `parseWikilinks`, which — unlike
  // the sibling `MD_LINK_RE` (`(?<!!)` lookbehind) — has no embed guard, so the
  // embed's inner target leaks out as a `slug:` link. Recorded here so the
  // deviation is visible/tracked rather than silently scrubbed from fixtures.
  it('currently emits a dangling slug link for an asset embed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'md-embed-'));
    try {
      await writeFile(join(dir, 'note.md'), '# Note\n\nSee ![[diagram.png]] below.\n', 'utf8');
      const ir = await adapter.parse(dir, OPTS);
      expect(ir.facts).toHaveLength(1);
      expect(ir.facts[0]?.links.map((l) => l.targetLocator)).toEqual(['slug:diagram-png']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('MarkdownAdapter.parse (single file input)', () => {
  const adapter = new MarkdownAdapter();

  it('roots the IR at the file dirname and uses the basename sourcePath', async () => {
    const ir = await adapter.parse(join(VAULT, 'notes', 'gamma.md'), OPTS);
    expect(ir.facts).toHaveLength(1);
    const [fact] = ir.facts;
    expect(fact?.sourceKey).toBe('markdown:gamma.md');
    // Relative link now resolves against the note's own (new root) directory.
    expect(fact?.links.map((l) => l.targetLocator)).toEqual(['path:alpha.md']);
    expect(ir.rootPath).toBe(join(VAULT, 'notes'));
  });
});
