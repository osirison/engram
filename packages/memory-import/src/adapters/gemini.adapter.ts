// Gemini (`GEMINI.md`) source adapter (WP4 PLAN §3.5 / T10). Parses the Gemini
// CLI's hierarchical instruction files into the common import IR.
//
// ── Web-verified [A] fields (Gemini CLI docs, verified 2026-07) ──────────────
// Hierarchy / precedence: the Gemini CLI concatenates GEMINI.md files by scope,
//   global `~/.gemini/GEMINI.md` → project-root `GEMINI.md` → ancestor dirs →
//   subdirectories of the CWD (more-specific appended/wins). We therefore tag
//   every fact with its level: `level:global` | `level:repo` | `level:nested`.
//   Source: https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html
// `@import` / include directives EXIST: current Gemini CLI supports importing
//   other Markdown files into a GEMINI.md via the `@path/to/file.md` syntax
//   (the "Memory Import Processor"). Only `.md` targets are supported; relative
//   and absolute paths are allowed; imports inside code fences/spans are ignored;
//   max recursion depth defaults to 5.
//   Source: https://geminicli.com/docs/reference/memport/
// DECISION — link, don't inline: we treat an `@….md` import (and the tolerant
//   `@import <path>` / `@file <path>` keyword variants some setups author) as an
//   `ImportedLink` (kind `md-relative`, `path:` locator) attached to the section
//   it appears in, rather than inlining the imported file's bytes. Rationale:
//   (1) the imported file is itself a GEMINI.md-adjacent `.md` that the walker or
//   the generic adapter can import as its own fact — inlining would duplicate
//   content and break round-trip identity; (2) keeping it a typed edge preserves
//   the authored relationship for T5's link resolver. Imports inside fenced code
//   blocks are skipped, matching the CLI's own processor.

import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { posix, resolve as resolveNative, sep as nativeSep } from 'node:path';
import { buildFacts } from './adapter-utils.js';
import type { ImportedFact, ImportedLink, ImportIR, SourceTool } from '../ir/types.js';
import type { ParseOptions, SourceAdapter } from '../ir/source-adapter.interface.js';

export const GEMINI_ADAPTER_VERSION = '1';

const GEMINI_FILE = 'GEMINI.md';
const BASE_TAGS = ['gemini', 'instructions'];
/** Directories never worth walking for instruction files. */
const SKIP_DIRS = new Set(['node_modules', '.git']);

type HierarchyLevel = 'global' | 'repo' | 'nested';

interface DiscoveredFile {
  /** Absolute path of the GEMINI.md file. */
  absPath: string;
  level: HierarchyLevel;
}

/** Convert a native absolute path to POSIX separators (for portable relpaths). */
function toPosix(p: string): string {
  return nativeSep === '/' ? p : p.split(nativeSep).join('/');
}

/**
 * `@`-import extraction (kept LOCAL to this adapter). Recognizes the Gemini CLI
 * `@path/to/file.md` directive plus the tolerant `@import <path>` / `@file
 * <path>` keyword forms, resolves the target against the containing file's dir,
 * and emits a `path:` `md-relative` link. `.md`-only, code-fence-aware.
 */
function extractImportLinks(body: string, sourceRelPath: string): ImportedLink[] {
  const out: ImportedLink[] = [];
  const seen = new Set<string>();
  let inFence = false;
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const raw = matchImportTarget(line);
    if (raw === null) continue;
    const locator = importLocator(sourceRelPath, raw);
    if (locator === null || seen.has(locator)) continue;
    seen.add(locator);
    out.push({
      kind: 'md-relative',
      rawTarget: raw,
      targetLocator: locator,
      relType: 'relates-to',
    });
  }
  return out;
}

/** Pull the target path out of a single import line, or null if none. */
function matchImportTarget(line: string): string | null {
  // Keyword form: `@import <path>` / `@file <path>` (optionally more text after).
  const kw = /(?:^|\s)@(?:import|file)\s+(?:["'`])?([^\s"'`]+)/i.exec(line);
  if (kw?.[1]) return stripPunctuation(kw[1]);
  // Bare Gemini form: `@path/to/file.md` (must be .md; not an email/scope token).
  const bare =
    /(?:^|\s)@([./~][^\s"'`]*\.md)\b/i.exec(line) ??
    /(?:^|\s)@([^\s"'`@/]+\/[^\s"'`]*\.md)\b/i.exec(line);
  if (bare?.[1]) return stripPunctuation(bare[1]);
  return null;
}

function stripPunctuation(target: string): string {
  return target.replace(/[),.;:]+$/, '');
}

/** Resolve an `@import` target (relative to the source file dir) to a `path:` locator. */
function importLocator(sourceRelPath: string, raw: string): string | null {
  if (!/\.md$/i.test(raw)) return null; // Gemini imports are .md-only
  if (raw.startsWith('~') || raw.startsWith('/')) {
    // Absolute/home import: keep normalized, strip a leading slash so it reads as a locator path.
    return `path:${posix.normalize(raw).replace(/^\//, '')}`;
  }
  const dir = posix.dirname(sourceRelPath);
  const resolved = posix.normalize(posix.join(dir, raw)).replace(/^\.\//, '');
  return `path:${resolved}`;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Recursively collect every `GEMINI.md` under `rootDir` (root first, then nested). */
async function walkGeminiFiles(rootDir: string): Promise<DiscoveredFile[]> {
  const found: DiscoveredFile[] = [];

  async function walk(dir: string): Promise<void> {
    // Infer Dirent<string>[] from the call; annotating with ReturnType picks the
    // Buffer overload under @types/node 25 and makes entry.name a Buffer.
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (entries === null) return;
    const subdirs: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        subdirs.push(resolveNative(dir, entry.name));
      } else if (entry.isFile() && entry.name === GEMINI_FILE) {
        const absPath = resolveNative(dir, entry.name);
        found.push({ absPath, level: dir === rootDir ? 'repo' : 'nested' });
      }
    }
    subdirs.sort();
    for (const sub of subdirs) await walk(sub);
  }

  await walk(rootDir);
  found.sort((a, b) => rank(a) - rank(b) || a.absPath.localeCompare(b.absPath));
  return found;
}

/** Repo-root GEMINI.md sorts before nested ones. */
function rank(f: DiscoveredFile): number {
  return f.level === 'repo' ? 0 : 1;
}

/** Cheap detect: does any `GEMINI.md` exist under `rootDir`? Returns on first hit. */
async function hasGeminiFile(rootDir: string): Promise<boolean> {
  const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => null);
  if (entries === null) return false;
  const subdirs: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name === GEMINI_FILE) return true;
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
      subdirs.push(resolveNative(rootDir, entry.name));
    }
  }
  for (const sub of subdirs) {
    if (await hasGeminiFile(sub)) return true;
  }
  return false;
}

export class GeminiAdapter implements SourceAdapter {
  readonly tool: SourceTool = 'gemini';

  async detect(path: string): Promise<boolean> {
    const abs = resolveNative(path);
    if (await fileExists(abs)) return posix.basename(toPosix(abs)) === GEMINI_FILE;
    if (!(await isDirectory(abs))) return false;
    return hasGeminiFile(abs);
  }

  async parse(path: string, opts: ParseOptions): Promise<ImportIR> {
    const abs = resolveNative(path);
    const isFile = await fileExists(abs);
    const rootDir = isFile ? posix.dirname(toPosix(abs)) : toPosix(abs);
    const rootDirNative = isFile ? resolveNative(abs, '..') : abs;

    const discovered: DiscoveredFile[] = isFile
      ? [{ absPath: abs, level: 'repo' }]
      : await walkGeminiFiles(rootDirNative);

    if (opts.includeGlobal) {
      const globalPath = resolveNative(homedir(), '.gemini', GEMINI_FILE);
      if (await fileExists(globalPath)) {
        discovered.unshift({ absPath: globalPath, level: 'global' });
      }
    }

    const facts: ImportedFact[] = [];
    for (const file of discovered) {
      const content = await readFile(file.absPath, 'utf8');
      const sourcePath = posix.relative(rootDir, toPosix(file.absPath));
      const tags = [...BASE_TAGS, `level:${file.level}`];
      const built = buildFacts({
        content,
        sourcePath,
        sourceTool: this.tool,
        tags,
        chunkMode: 'split',
      });
      for (const fact of built) mergeImportLinks(fact);
      facts.push(...built);
    }

    return {
      sourceTool: this.tool,
      rootPath: rootDir,
      facts,
      provenance: {
        importedAt: opts.importedAt,
        importBatchId: opts.importBatchId,
        ...(opts.host !== undefined ? { host: opts.host } : {}),
        adapterVersion: GEMINI_ADAPTER_VERSION,
      },
    };
  }
}

/** Append `@import` edges to a fact, deduped against its existing links. */
function mergeImportLinks(fact: ImportedFact): void {
  const extra = extractImportLinks(fact.content, fact.sourcePath);
  if (extra.length === 0) return;
  const seen = new Set(fact.links.map((l) => `${l.relType} ${l.targetLocator}`));
  for (const link of extra) {
    const key = `${link.relType} ${link.targetLocator}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fact.links.push(link);
  }
}
