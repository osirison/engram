import { describe, it, expect } from 'vitest';
import {
  emitWikilink,
  emitWikilinkToken,
  parseWikilinks,
  escapeWikilinkBrackets,
  unescapeWikilinkBrackets,
} from './wikilink.js';
import type { MemoryEdge } from './edge-types.js';

describe('emitWikilinkToken', () => {
  it('emits a bare token without display', () => {
    expect(emitWikilinkToken('clx01')).toBe('[[clx01]]');
  });
  it('emits target|display when display is provided', () => {
    expect(emitWikilinkToken('clx01', 'Nice title')).toBe('[[clx01|Nice title]]');
  });
});

describe('emitWikilink', () => {
  it('renders a durable edge as bold rel + live wikilink', () => {
    const edge: MemoryEdge = { rel: 'derived-from', target: 'clx01', origin: 'durable' };
    expect(emitWikilink(edge, { display: 'Architecture insight' })).toBe(
      '**derived-from** [[clx01|Architecture insight]]'
    );
  });

  it('appends a 2-decimal score for derived edges', () => {
    const edge: MemoryEdge = {
      rel: 'duplicate-of',
      target: 'clw02',
      origin: 'derived',
      score: 0.981,
    };
    expect(emitWikilink(edge, { display: 'We chose pgvector' })).toBe(
      '**duplicate-of** [[clw02|We chose pgvector]] (0.98)'
    );
  });

  it('renders a dangling edge as plain text, never a live [[…]]', () => {
    const edge: MemoryEdge = {
      rel: 'duplicate-of',
      target: 'clw0000dupmemory02',
      origin: 'derived',
      dangling: true,
    };
    const out = emitWikilink(edge, { display: 'ignored display' });
    expect(out).toBe('**duplicate-of** clw0000dupmemory02 (not in export)');
    expect(out).not.toContain('[[');
  });

  it('targets an intra-doc anchor in single-doc mode', () => {
    const edge: MemoryEdge = { rel: 'relates-to', target: 'clx01', origin: 'durable' };
    expect(emitWikilink(edge, { display: 'Other memory', anchor: true })).toBe(
      '**relates-to** [[#mem-clx01|Other memory]]'
    );
  });
});

describe('parseWikilinks', () => {
  it('extracts target and display', () => {
    expect(parseWikilinks('see [[clx01|Nice title]] here')).toEqual([
      { target: 'clx01', display: 'Nice title' },
    ]);
  });

  it('extracts a bare target with no display', () => {
    expect(parseWikilinks('[[clx01]]')).toEqual([{ target: 'clx01' }]);
  });

  it('extracts multiple links in order', () => {
    const md = '- **derived-from** [[a|A]]\n- **duplicate-of** [[b|B]] (0.98)';
    expect(parseWikilinks(md)).toEqual([
      { target: 'a', display: 'A' },
      { target: 'b', display: 'B' },
    ]);
  });

  it('ignores escaped brackets (content), matches only real links', () => {
    const escaped = escapeWikilinkBrackets('literal [[not a link]] in body');
    expect(parseWikilinks(escaped)).toEqual([]);
  });
});

describe('escape/unescape wikilink brackets (round-trip)', () => {
  it('is a byte-exact inverse for content containing [[ and ]]', () => {
    const content = 'Code: arr[[0]] and a wiki-ish [[x|y]] plus ]] stray';
    const escaped = escapeWikilinkBrackets(content);
    expect(escaped).not.toContain('[[');
    expect(unescapeWikilinkBrackets(escaped)).toBe(content);
  });

  it('leaves single brackets untouched', () => {
    const content = 'array[0] and map[key] are fine';
    expect(escapeWikilinkBrackets(content)).toBe(content);
    expect(unescapeWikilinkBrackets(content)).toBe(content);
  });

  it('emit → parse recovers target and display (inline mirror is lossy on score)', () => {
    const edge: MemoryEdge = {
      rel: 'duplicate-of',
      target: 'clw02',
      origin: 'derived',
      score: 0.981,
    };
    const line = emitWikilink(edge, { display: 'We chose pgvector' });
    expect(parseWikilinks(line)).toEqual([{ target: 'clw02', display: 'We chose pgvector' }]);
  });
});
