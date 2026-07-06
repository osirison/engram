import { describe, it, expect } from 'vitest';
import {
  extractLinks,
  extractWikilinks,
  extractRelativeLinks,
  extractFrontmatterLinks,
  deriveFactLocators,
  wikilinkLocator,
  fileStemSlug,
} from './links.js';

describe('wikilinkLocator', () => {
  it.each([
    ['feedback-worktree', 'slug:feedback-worktree'],
    ['Feedback Worktree', 'slug:feedback-worktree'],
    ['feedback-worktree#heading', 'slug:feedback-worktree'],
  ])('normalizes %j → %j', (raw, expected) => {
    expect(wikilinkLocator(raw)).toBe(expected);
  });
});

describe('fileStemSlug', () => {
  it.each([
    ['feedback-worktree.md', 'feedback-worktree'],
    ['backlog.instructions.md', 'backlog'],
    ['context-mem.mdc', 'context-mem'],
    ['GEMINI.md', 'gemini'],
  ])('strips markdown extensions from %j → %j', (file, expected) => {
    expect(fileStemSlug(file)).toBe(expected);
  });
});

describe('extractWikilinks', () => {
  it('extracts plain, aliased, and heading wikilinks and dedupes', () => {
    const body =
      'See [[feedback-worktree]] and [[feedback-worktree|the rule]] plus [[other-note#h2]].';
    const links = extractWikilinks(body);
    expect(links).toEqual([
      {
        kind: 'wikilink',
        rawTarget: 'feedback-worktree',
        targetLocator: 'slug:feedback-worktree',
        relType: 'relates-to',
      },
      {
        kind: 'wikilink',
        rawTarget: 'other-note#h2',
        targetLocator: 'slug:other-note',
        relType: 'relates-to',
      },
    ]);
  });

  it('ignores escaped wikilinks', () => {
    expect(extractWikilinks('literal \\[\\[not-a-link\\]\\]')).toEqual([]);
  });
});

describe('extractRelativeLinks', () => {
  it('extracts standard markdown links to markdown targets, resolved repo-relative', () => {
    const links = extractRelativeLinks(
      'Follow [AGENTS.md](../AGENTS.md) and [setup](../docs/SETUP.md).',
      'sub/CLAUDE.md'
    );
    expect(links.map((l) => l.targetLocator)).toEqual(['path:AGENTS.md', 'path:docs/SETUP.md']);
    expect(links[0]?.kind).toBe('md-relative');
  });

  it('preserves a target anchor', () => {
    const links = extractRelativeLinks('[x](./notes.md#section)', 'a/b.md');
    expect(links[0]?.targetLocator).toBe('path:a/notes.md#section');
  });

  it('supports the arrow form', () => {
    const links = extractRelativeLinks('[README.md] → ../README.md', 'pkg/GEMINI.md');
    expect(links[0]?.targetLocator).toBe('path:README.md');
  });

  it('skips external, anchor-only, image, and non-markdown targets', () => {
    const body = [
      '[site](https://example.com)',
      '[mail](mailto:a@b.com)',
      '[top](#heading)',
      '![img](./pic.png)',
      '[code](../src/index.ts)',
      '[dir](apps/mcp-server)',
    ].join('\n');
    expect(extractRelativeLinks(body, 'x/y.md')).toEqual([]);
  });
});

describe('extractFrontmatterLinks', () => {
  it('maps canonical typed edges to id: locators, skipping derived + unknown rels', () => {
    const fm = {
      links: [
        { rel: 'relates-to', target: 'abc123', origin: 'durable' },
        { rel: 'duplicate-of', target: 'dup1', origin: 'derived' }, // skipped (derived)
        { rel: 'not-a-rel', target: 'zzz', origin: 'durable' }, // skipped (unknown rel)
        { rel: 'supersedes', target: 'old9', origin: 'durable' },
      ],
    };
    expect(extractFrontmatterLinks(fm)).toEqual([
      {
        kind: 'frontmatter-ref',
        rawTarget: 'abc123',
        targetLocator: 'id:abc123',
        relType: 'relates-to',
      },
      {
        kind: 'frontmatter-ref',
        rawTarget: 'old9',
        targetLocator: 'id:old9',
        relType: 'supersedes',
      },
    ]);
  });

  it('returns [] when there is no links array', () => {
    expect(extractFrontmatterLinks({ name: 'x' })).toEqual([]);
    expect(extractFrontmatterLinks(undefined)).toEqual([]);
  });
});

describe('extractLinks', () => {
  it('merges frontmatter edges, wikilinks, and relative links, deduped by (rel, locator)', () => {
    const body = 'Body [[note-a]] and [doc](./doc.md).';
    const fm = { links: [{ rel: 'relates-to', target: 'id9', origin: 'durable' }] };
    const links = extractLinks(body, 'dir/file.md', fm);
    expect(links.map((l) => `${l.relType} ${l.targetLocator}`)).toEqual([
      'relates-to id:id9',
      'relates-to slug:note-a',
      'relates-to path:dir/doc.md',
    ]);
  });
});

describe('deriveFactLocators', () => {
  it('yields the path, filename-stem slug, and frontmatter-name slug', () => {
    const locators = deriveFactLocators({
      sourcePath: 'memory/feedback-worktree.md',
      frontmatter: { name: 'feedback-worktree' },
    });
    expect(locators).toContain('path:memory/feedback-worktree.md');
    expect(locators).toContain('slug:feedback-worktree');
  });

  it('includes the section anchor in the path locator for chunked facts', () => {
    const locators = deriveFactLocators({ sourcePath: 'CLAUDE.md', anchor: 'commands' });
    expect(locators).toContain('path:CLAUDE.md#commands');
  });

  it('adds a distinct slug when frontmatter name differs from the filename', () => {
    const locators = deriveFactLocators({
      sourcePath: 'rules/x.mdc',
      frontmatter: { name: 'My Cursor Rule' },
    });
    expect(locators).toContain('slug:x');
    expect(locators).toContain('slug:my-cursor-rule');
  });
});
