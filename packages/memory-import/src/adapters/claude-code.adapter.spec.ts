import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ClaudeCodeAdapter, CLAUDE_CODE_ADAPTER_VERSION } from './claude-code.adapter.js';
import type { ParseOptions } from '../ir/source-adapter.interface.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, '__fixtures__', 'claude-code');
const AUTO_MEMORY = join(FIX, 'auto-memory');
const PROJECT = join(FIX, 'project');

const OPTS: ParseOptions = {
  importBatchId: 'batch-t6',
  importedAt: '2026-07-06T00:00:00.000Z',
  host: 'test-host',
};

const adapter = new ClaudeCodeAdapter();

describe('ClaudeCodeAdapter.detect', () => {
  it('detects an auto-memory directory (memory/MEMORY.md present)', async () => {
    expect(await adapter.detect(AUTO_MEMORY)).toBe(true);
  });

  it('detects a project directory containing CLAUDE.md', async () => {
    expect(await adapter.detect(PROJECT)).toBe(true);
  });

  it('detects a CLAUDE.md file passed directly', async () => {
    expect(await adapter.detect(join(PROJECT, 'CLAUDE.md'))).toBe(true);
  });

  it('returns false for an unrelated directory and a missing path', async () => {
    expect(await adapter.detect(join(AUTO_MEMORY, 'memory'))).toBe(false);
    expect(await adapter.detect(join(FIX, 'does-not-exist'))).toBe(false);
  });
});

describe('ClaudeCodeAdapter.parse — auto-memory', () => {
  it('imports one atomic fact per memory/*.md, excluding the MEMORY.md index', async () => {
    const ir = await adapter.parse(AUTO_MEMORY, OPTS);

    expect(ir.sourceTool).toBe('claude-code');
    expect(ir.rootPath).toBe(AUTO_MEMORY);
    expect(ir.provenance).toEqual({
      importBatchId: 'batch-t6',
      importedAt: '2026-07-06T00:00:00.000Z',
      host: 'test-host',
      adapterVersion: CLAUDE_CODE_ADAPTER_VERSION,
    });

    // 4 fact files (MEMORY.md excluded); each atomic → exactly one fact.
    expect(ir.facts).toHaveLength(4);
    const keys = ir.facts.map((f) => f.sourceKey);
    expect(keys).toContain('claude-code:memory/feedback-worktree.md');
    expect(keys).toContain('claude-code:memory/feedback-comprehensive-tests.md');
    expect(keys).toContain('claude-code:memory/project-engram-userid.md');
    expect(keys).toContain('claude-code:memory/misc-note.md');
    expect(keys).not.toContain('claude-code:memory/MEMORY.md');

    // sourcePath is POSIX-relative to rootPath; no anchor on atomic facts.
    for (const fact of ir.facts) {
      expect(fact.sourcePath.startsWith('memory/')).toBe(true);
      expect(fact.anchor).toBeUndefined();
      expect(fact.localId).toBe(fact.sourceKey);
    }
  });

  it('derives tags from frontmatter.metadata.type, omitting the type tag when absent', async () => {
    const ir = await adapter.parse(AUTO_MEMORY, OPTS);
    const byKey = (key: string) => ir.facts.find((f) => f.sourceKey === key);

    expect(byKey('claude-code:memory/feedback-worktree.md')?.tags).toEqual([
      'claude-code',
      'feedback',
    ]);
    expect(byKey('claude-code:memory/project-engram-userid.md')?.tags).toEqual([
      'claude-code',
      'project',
    ]);
    // No metadata.type → only the base tag.
    expect(byKey('claude-code:memory/misc-note.md')?.tags).toEqual(['claude-code']);
  });

  it('preserves frontmatter and extracts [[wikilinks]] as slug: links', async () => {
    const ir = await adapter.parse(AUTO_MEMORY, OPTS);
    const worktree = ir.facts.find(
      (f) => f.sourceKey === 'claude-code:memory/feedback-worktree.md'
    );
    expect(worktree?.frontmatter).toMatchObject({
      name: 'feedback-worktree',
      metadata: { type: 'feedback', node_type: 'preference' },
    });
    expect(worktree?.title).toBe('feedback-worktree');
    expect(worktree?.content).not.toContain('name: feedback-worktree');
    expect(worktree?.links.map((l) => l.targetLocator)).toEqual([
      'slug:feedback-comprehensive-tests',
    ]);
    const [link] = worktree?.links ?? [];
    expect(link?.kind).toBe('wikilink');
    expect(link?.relType).toBe('relates-to');

    // Reciprocal wikilink from the other fact.
    const tests = ir.facts.find(
      (f) => f.sourceKey === 'claude-code:memory/feedback-comprehensive-tests.md'
    );
    expect(tests?.links.map((l) => l.targetLocator)).toEqual(['slug:feedback-worktree']);
  });
});

describe('ClaudeCodeAdapter.parse — bare instructions', () => {
  it('H2-chunks a project CLAUDE.md directory into anchored instruction facts', async () => {
    const ir = await adapter.parse(PROJECT, OPTS);

    expect(ir.rootPath).toBe(PROJECT);
    expect(ir.facts.map((f) => f.sourceKey)).toEqual([
      'claude-code:CLAUDE.md#overview',
      'claude-code:CLAUDE.md#commands',
      'claude-code:CLAUDE.md#architecture',
    ]);
    for (const fact of ir.facts) {
      expect(fact.tags).toEqual(['claude-code', 'instructions']);
      expect(fact.sourcePath).toBe('CLAUDE.md');
    }

    const commands = ir.facts.find((f) => f.anchor === 'commands');
    expect(commands?.title).toBe('Commands');
    expect(commands?.links.map((l) => l.targetLocator)).toContain('path:AGENTS.md');
  });

  it('accepts a CLAUDE.md file passed directly (root = its dirname)', async () => {
    const ir = await adapter.parse(join(PROJECT, 'CLAUDE.md'), OPTS);
    expect(ir.rootPath).toBe(PROJECT);
    expect(ir.facts.every((f) => f.sourcePath === 'CLAUDE.md')).toBe(true);
    expect(ir.facts.map((f) => f.anchor)).toEqual(['overview', 'commands', 'architecture']);
  });
});
