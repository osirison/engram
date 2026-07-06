import type { SourceTool } from '@engram/memory-import';

/**
 * Map a changed file (absolute or relative path) to the WP4 importer source
 * whose adapter parses it, or `null` if the file is not a watched agent-memory
 * file. Used by the watcher to decide which importer to run on a change.
 */
export function mapFileToSource(filePath: string): SourceTool | null {
  const p = filePath.replace(/\\/g, '/');
  const base = p.slice(p.lastIndexOf('/') + 1);

  // Claude Code: CLAUDE.md / CLAUDE.local.md and auto-memory MEMORY.md + topics.
  if (base === 'CLAUDE.md' || base === 'CLAUDE.local.md') return 'claude-code';
  if (/\/\.claude\/(?:projects\/[^/]+\/)?memory\/[^/]+\.md$/.test(p))
    return 'claude-code';

  // Codex: AGENTS.md (repo + global).
  if (base === 'AGENTS.md') return 'codex';

  // Gemini: GEMINI.md (repo + global).
  if (base === 'GEMINI.md') return 'gemini';

  // Cursor: modern .mdc rules and legacy .cursorrules.
  if (base === '.cursorrules') return 'cursor';
  if (/\/\.cursor\/rules\/[^/]+\.mdc$/.test(p)) return 'cursor';

  // Copilot: repo-wide + scoped instruction files.
  if (/\/\.github\/copilot-instructions\.md$/.test(p)) return 'copilot';
  if (/\/\.github\/instructions\/[^/]+\.instructions\.md$/.test(p))
    return 'copilot';

  return null;
}

/** Whether a changed file is one the watcher should act on. */
export function isWatchedFile(filePath: string): boolean {
  return mapFileToSource(filePath) !== null;
}

/**
 * Derive the root to hand the WP4 importer for a changed file — the directory the
 * source's adapter expects (e.g. the dir containing `CLAUDE.md`, `memory/`,
 * `.cursor/`, or `.github/`). Handing the importer the raw watch root would miss
 * nested files (the claude-code adapter does not recurse). Returns null if the
 * file is not a watched memory file.
 */
export function deriveImportRoot(filePath: string): string | null {
  const p = filePath.replace(/\\/g, '/');
  const source = mapFileToSource(p);
  if (source === null) return null;

  const dir = p.slice(0, p.lastIndexOf('/')) || '/';
  const base = p.slice(p.lastIndexOf('/') + 1);
  const before = (anchor: string): string => {
    const i = p.lastIndexOf(anchor);
    return i === -1 ? dir : p.slice(0, i) || '/';
  };

  if (source === 'claude-code') {
    if (base === 'CLAUDE.md' || base === 'CLAUDE.local.md') return dir;
    return before('/memory/'); // auto-memory: the dir that contains memory/
  }
  if (source === 'cursor') {
    return base === '.cursorrules' ? dir : before('/.cursor/');
  }
  if (source === 'copilot') return before('/.github/');
  // codex (AGENTS.md) + gemini (GEMINI.md) are read from their own directory.
  return dir;
}
