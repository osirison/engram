// OpenAI Codex (AGENTS.md) source adapter (WP4 PLAN §3.4, T9). Codex reads plain
// markdown `AGENTS.md` instruction files discovered by directory precedence and
// MERGES (concatenates) them, closest-to-cwd last so nearer files win.
//
// VERIFY (WebSearch of the AGENTS.md spec + OpenAI Codex docs,
// developers.openai.com/codex/guides/agents-md and github.com/openai/codex
// docs/agents_md.md):
//   (a) Search order: starting at the project root (Git root), Codex walks DOWN
//       to the current working directory; in each directory it checks
//       `AGENTS.override.md`, then `AGENTS.md`, then configured fallback names,
//       using the first non-empty file at that level. The Codex home file
//       (`~/.codex/AGENTS.md`, or `AGENTS.override.md` there) is the base layer.
//   (b) MERGE vs override: Codex MERGES across levels — matched files are
//       CONCATENATED in order, files closer to the cwd appearing LATER and thus
//       taking precedence for conflicting guidance (an `AGENTS.override.md` at a
//       level REPLACES parent instructions instead of extending them; total size
//       capped at 32 KiB by default via `project_doc_max_bytes`).
//   Resolved precedence (highest → lowest):
//       AGENTS.override.md → closest AGENTS.md → parent-dir AGENTS.md →
//       ~/.codex/AGENTS.md.
//
// This adapter does NOT merge the text: each AGENTS.md is imported as its own
// facts, tagged with the hierarchy LEVEL it was found at (`level:global` |
// `level:repo` | `level:nested`) so the precedence is recorded per fact while
// each file stays individually addressable and re-import-updatable.

import { promises as fs } from 'node:fs';
import { posix, resolve as resolveAbs } from 'node:path';
import * as os from 'node:os';
import type { ImportedFact, ImportIR, SourceTool } from '../ir/types.js';
import type { ParseOptions, SourceAdapter } from '../ir/source-adapter.interface.js';
import { buildFacts } from './adapter-utils.js';

export const CODEX_ADAPTER_VERSION = '1';

/** The canonical instruction filename Codex discovers at every hierarchy level. */
const AGENTS_FILE = 'AGENTS.md';

/** Directories never walked for AGENTS.md (vendored / VCS metadata). */
const SKIP_DIRS: ReadonlySet<string> = new Set(['node_modules', '.git']);

/** Base tags applied to every Codex fact regardless of hierarchy level. */
const BASE_TAGS: readonly string[] = ['codex', 'agents-md', 'instructions'];

/** Hierarchy level an AGENTS.md was discovered at (drives the `level:*` tag). */
type Level = 'global' | 'repo' | 'nested';

interface DiscoveredFile {
  /** Absolute path to the AGENTS.md file. */
  absPath: string;
  level: Level;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Recursively collect AGENTS.md files under `dir`, skipping vendored/VCS trees.
 * The file directly in `rootDir` is `level:repo`; anything deeper is
 * `level:nested`.
 */
async function walkForAgents(dir: string, rootDir: string, out: DiscoveredFile[]): Promise<void> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = posix.join(dir.split('\\').join('/'), entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walkForAgents(abs, rootDir, out);
      } else if (entry.isFile() && entry.name === AGENTS_FILE) {
        const level: Level = dir === rootDir ? 'repo' : 'nested';
        out.push({ absPath: abs, level });
      }
    }
  } catch {
    // Unreadable directory (permissions, race): skip it rather than fail the walk.
  }
}

/** POSIX path of `absPath` relative to `rootDir`. */
function relPosix(rootDir: string, absPath: string): string {
  const root = rootDir.split('\\').join('/');
  const abs = absPath.split('\\').join('/');
  return posix.relative(root, abs).split('\\').join('/');
}

/** Options for {@link CodexAdapter}; the global path is injectable for tests. */
export interface CodexAdapterOptions {
  /**
   * Absolute path to the Codex home instruction file. Defaults to
   * `~/.codex/AGENTS.md`; tests inject a synthetic path so the real home dir is
   * never touched. Only read when `opts.includeGlobal` is set.
   */
  globalAgentsPath?: string;
}

export class CodexAdapter implements SourceAdapter {
  readonly tool: SourceTool = 'codex';

  private readonly globalAgentsPath: string;

  constructor(options: CodexAdapterOptions = {}) {
    this.globalAgentsPath =
      options.globalAgentsPath ?? resolveAbs(os.homedir(), '.codex', AGENTS_FILE);
  }

  /** True when `path` is an AGENTS.md file, or a dir containing one (root/nested). */
  async detect(path: string): Promise<boolean> {
    const abs = resolveAbs(path);
    if (!(await isDirectory(abs))) {
      return posix.basename(abs.split('\\').join('/')) === AGENTS_FILE && (await pathExists(abs));
    }
    if (await pathExists(posix.join(abs.split('\\').join('/'), AGENTS_FILE))) return true;
    const found: DiscoveredFile[] = [];
    await walkForAgents(abs, abs, found);
    return found.length > 0;
  }

  async parse(path: string, opts: ParseOptions): Promise<ImportIR> {
    const abs = resolveAbs(path);
    const dir = await isDirectory(abs);
    const rootPath = dir ? abs : posix.dirname(abs.split('\\').join('/'));
    const rootPosix = rootPath.split('\\').join('/');

    const discovered: DiscoveredFile[] = [];
    if (dir) {
      await walkForAgents(rootPosix, rootPosix, discovered);
    } else if (posix.basename(abs.split('\\').join('/')) === AGENTS_FILE) {
      discovered.push({ absPath: abs, level: 'repo' });
    }

    if (opts.includeGlobal && (await pathExists(this.globalAgentsPath))) {
      discovered.push({ absPath: resolveAbs(this.globalAgentsPath), level: 'global' });
    }

    const facts: ImportedFact[] = [];
    for (const file of discovered) {
      const content = await fs.readFile(file.absPath, 'utf8');
      const sourcePath = relPosix(rootPosix, file.absPath);
      facts.push(
        ...buildFacts({
          content,
          sourcePath,
          sourceTool: this.tool,
          tags: [...BASE_TAGS, `level:${file.level}`],
          chunkMode: 'split',
        })
      );
    }

    return {
      sourceTool: this.tool,
      rootPath,
      facts,
      provenance: {
        importedAt: opts.importedAt,
        importBatchId: opts.importBatchId,
        ...(opts.host !== undefined ? { host: opts.host } : {}),
        adapterVersion: CODEX_ADAPTER_VERSION,
      },
    };
  }
}
