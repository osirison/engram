import {
  deriveImportRoot,
  isWatchedFile,
  mapFileToSource,
} from './path-mapping';

describe('mapFileToSource', () => {
  it.each([
    ['/home/qp/proj/CLAUDE.md', 'claude-code'],
    ['/home/qp/proj/CLAUDE.local.md', 'claude-code'],
    [
      '/home/qp/.claude/projects/engram/memory/feedback-worktree.md',
      'claude-code',
    ],
    ['/home/qp/proj/AGENTS.md', 'codex'],
    ['/home/qp/proj/GEMINI.md', 'gemini'],
    ['/home/qp/proj/.cursorrules', 'cursor'],
    ['/home/qp/proj/.cursor/rules/engram-memory.mdc', 'cursor'],
    ['/home/qp/proj/.github/copilot-instructions.md', 'copilot'],
    ['/home/qp/proj/.github/instructions/api.instructions.md', 'copilot'],
  ])('maps %s -> %s', (path, expected) => {
    expect(mapFileToSource(path)).toBe(expected);
  });

  it.each([
    ['/home/qp/proj/README.md'],
    ['/home/qp/proj/src/index.ts'],
    ['/home/qp/proj/.cursor/rules/notes.txt'],
    ['/home/qp/proj/docs/CLAUDE-notes.md'],
  ])('returns null for non-memory file %s', (path) => {
    expect(mapFileToSource(path)).toBeNull();
    expect(isWatchedFile(path)).toBe(false);
  });

  it('normalizes windows-style separators', () => {
    expect(mapFileToSource('C:\\repo\\.cursor\\rules\\x.mdc')).toBe('cursor');
  });
});

describe('deriveImportRoot', () => {
  it.each([
    ['/home/qp/proj/CLAUDE.md', '/home/qp/proj'],
    ['/home/qp/proj/CLAUDE.local.md', '/home/qp/proj'],
    // auto-memory: root is the dir that CONTAINS memory/, not the memory dir
    [
      '/home/qp/.claude/projects/engram/memory/feedback.md',
      '/home/qp/.claude/projects/engram',
    ],
    ['/home/qp/proj/AGENTS.md', '/home/qp/proj'],
    ['/home/qp/proj/GEMINI.md', '/home/qp/proj'],
    ['/home/qp/proj/.cursorrules', '/home/qp/proj'],
    // nested .cursor/.github: root is the dir that CONTAINS them
    ['/home/qp/proj/.cursor/rules/engram-memory.mdc', '/home/qp/proj'],
    ['/home/qp/proj/.github/copilot-instructions.md', '/home/qp/proj'],
    ['/home/qp/proj/.github/instructions/api.instructions.md', '/home/qp/proj'],
  ])('derives %s -> %s', (path, expected) => {
    expect(deriveImportRoot(path)).toBe(expected);
  });

  it('returns null for a non-memory file', () => {
    expect(deriveImportRoot('/home/qp/proj/README.md')).toBeNull();
  });
});
