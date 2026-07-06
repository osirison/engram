import { describe, it, expect } from 'vitest';
import { buildFacts, makeSourceKey } from './adapter-utils.js';

describe('makeSourceKey', () => {
  it('formats <tool>:<path> with an optional anchor', () => {
    expect(makeSourceKey('claude-code', 'memory/x.md')).toBe('claude-code:memory/x.md');
    expect(makeSourceKey('codex', 'AGENTS.md', 'commands')).toBe('codex:AGENTS.md#commands');
  });
});

describe('buildFacts', () => {
  it('atomic mode: one fact, frontmatter preserved, wikilinks extracted', () => {
    const content = [
      '---',
      'name: feedback-worktree',
      'type: feedback',
      '---',
      'Always use a worktree. Related: [[feedback-comprehensive-tests]].',
    ].join('\n');
    const facts = buildFacts({
      content,
      sourcePath: 'memory/feedback-worktree.md',
      sourceTool: 'claude-code',
      tags: ['claude-code', 'feedback'],
      chunkMode: 'atomic',
    });
    expect(facts).toHaveLength(1);
    const [fact] = facts;
    expect(fact?.sourceKey).toBe('claude-code:memory/feedback-worktree.md');
    expect(fact?.title).toBe('feedback-worktree');
    expect(fact?.frontmatter).toMatchObject({ name: 'feedback-worktree', type: 'feedback' });
    expect(fact?.content).not.toContain('---');
    expect(fact?.links.map((l) => l.targetLocator)).toEqual(['slug:feedback-comprehensive-tests']);
    expect(fact?.localId).toBe(fact?.sourceKey);
  });

  it('split mode: one fact per H2 with anchored sourceKeys', () => {
    const content = [
      'Preamble long enough to survive the fragment fold '.repeat(6),
      '## Commands',
      'Run the build. See [AGENTS.md](AGENTS.md).'.repeat(8),
      '## Architecture',
      'The architecture section body goes here and is long enough.'.repeat(4),
    ].join('\n');
    const facts = buildFacts({
      content,
      sourcePath: 'CLAUDE.md',
      sourceTool: 'claude-code',
      tags: ['claude-code', 'instructions'],
      chunkMode: 'split',
    });
    expect(facts.map((f) => f.sourceKey)).toEqual([
      'claude-code:CLAUDE.md#overview',
      'claude-code:CLAUDE.md#commands',
      'claude-code:CLAUDE.md#architecture',
    ]);
    // Relative md link resolves against CLAUDE.md's dir (repo root).
    const commands = facts.find((f) => f.anchor === 'commands');
    expect(commands?.links.map((l) => l.targetLocator)).toContain('path:AGENTS.md');
  });

  it('auto mode: stays atomic for a small file, splits a large multi-H2 file', () => {
    const small = '## A\nshort a\n## B\nshort b';
    expect(
      buildFacts({
        content: small,
        sourcePath: 'x.md',
        sourceTool: 'markdown',
        tags: [],
        chunkMode: 'auto',
      })
    ).toHaveLength(1);

    const big = `## A\n${'x'.repeat(1500)}\n## B\n${'y'.repeat(1500)}`;
    expect(
      buildFacts({
        content: big,
        sourcePath: 'y.md',
        sourceTool: 'markdown',
        tags: [],
        chunkMode: 'auto',
      }).length
    ).toBeGreaterThan(1);
  });

  it('attaches frontmatter + frontmatter-edges to the first chunk only', () => {
    const content = [
      '---',
      'title: Doc',
      'links:',
      '  - rel: relates-to',
      '    target: mem-abc',
      '    origin: durable',
      '---',
      `Overview preamble ${'padding '.repeat(40)}`,
      '## Section Two',
      `Body two ${'padding '.repeat(40)}`,
    ].join('\n');
    const facts = buildFacts({
      content,
      sourcePath: 'doc.md',
      sourceTool: 'markdown',
      tags: ['markdown'],
      chunkMode: 'split',
    });
    const first = facts[0];
    const second = facts[1];
    expect(first?.frontmatter).toBeDefined();
    expect(first?.links.some((l) => l.targetLocator === 'id:mem-abc')).toBe(true);
    expect(second?.frontmatter).toBeUndefined();
    expect(second?.links.some((l) => l.targetLocator === 'id:mem-abc')).toBe(false);
  });

  it('drops empty content', () => {
    expect(
      buildFacts({
        content: '---\nname: x\n---\n',
        sourcePath: 'e.md',
        sourceTool: 'markdown',
        tags: [],
        chunkMode: 'atomic',
      })
    ).toEqual([]);
  });
});
