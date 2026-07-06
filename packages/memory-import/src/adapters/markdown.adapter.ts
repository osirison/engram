// Generic markdown / Obsidian-vault adapter (WP4 PLAN §3.6, T11). A folder of
// `*.md` notes with optional YAML frontmatter, `[[wikilinks]]` and/or relative
// `[t](./other.md)` links, and an optional index/MOC file. One note maps 1:1 to
// a memory (chunkMode 'atomic'); `opts.splitHeadings` opts into H2 chunking.
// Frontmatter `tags` merge onto the base `['markdown']` tag; a designated
// index/MOC note is skipped so a "map of content" doesn't become a fact.

import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { buildFacts, type ChunkMode } from './adapter-utils.js';
import { splitFrontmatter } from '../parse/frontmatter.js';
import type { ImportIR, ImportedFact, ProvenanceCommon, SourceTool } from '../ir/types.js';
import type { ParseOptions, SourceAdapter } from '../ir/source-adapter.interface.js';

/** Bump when the markdown mapping (tags / skip rules / chunking) changes. */
export const MARKDOWN_ADAPTER_VERSION = '1';

/** Extensions treated as importable markdown notes. */
const MARKDOWN_EXT_RE = /\.(md|markdown)$/i;

/** Directories never descended into during the vault walk. */
function isIgnoredDir(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules';
}

/** Frontmatter-derived tags: a string or string[] `tags` field, else none. */
function frontmatterTags(frontmatter: Record<string, unknown> | undefined): string[] {
  const raw = frontmatter?.['tags'];
  if (typeof raw === 'string') return raw.trim().length > 0 ? [raw.trim()] : [];
  if (Array.isArray(raw)) {
    return raw
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
  }
  return [];
}

/**
 * A note is treated as a skippable index/MOC when ANY holds:
 *  - it is a TOP-LEVEL `MEMORY.md` (name rule; sub-folder MEMORY.md is kept),
 *  - frontmatter `moc: true`,
 *  - frontmatter `node_type` is `index` or `moc` (case-insensitive).
 */
function isIndexFile(
  sourcePath: string,
  frontmatter: Record<string, unknown> | undefined
): boolean {
  if (!sourcePath.includes('/') && /^MEMORY\.md$/i.test(sourcePath)) return true;
  if (frontmatter?.['moc'] === true) return true;
  const nodeType = frontmatter?.['node_type'];
  if (typeof nodeType === 'string') {
    const nt = nodeType.trim().toLowerCase();
    if (nt === 'index' || nt === 'moc') return true;
  }
  return false;
}

/** Recursively collect absolute paths of markdown files, sorted for determinism. */
async function walkMarkdown(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isIgnoredDir(entry.name)) continue;
      files.push(...(await walkMarkdown(full)));
    } else if (entry.isFile() && MARKDOWN_EXT_RE.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/** Cheap early-exit probe: does the tree contain any markdown note? */
async function hasMarkdown(dir: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true });
  const subdirs: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && MARKDOWN_EXT_RE.test(entry.name)) return true;
    if (entry.isDirectory() && !isIgnoredDir(entry.name)) subdirs.push(entry.name);
  }
  for (const name of subdirs) {
    if (await hasMarkdown(join(dir, name))) return true;
  }
  return false;
}

/** POSIX path of `file` relative to `rootPath` (adapter contract). */
function toSourcePath(rootPath: string, file: string): string {
  return posix.normalize(
    file
      .slice(rootPath.length)
      .replace(/^[\\/]+/, '')
      .split(sep)
      .join(posix.sep)
  );
}

export class MarkdownAdapter implements SourceAdapter {
  readonly tool: SourceTool = 'markdown';

  /** True when `path` is a directory that contains at least one markdown note. */
  async detect(path: string): Promise<boolean> {
    try {
      const st = await stat(path);
      if (!st.isDirectory()) return false;
      return await hasMarkdown(resolve(path));
    } catch {
      return false;
    }
  }

  async parse(path: string, opts: ParseOptions): Promise<ImportIR> {
    const abs = resolve(path);
    const st = await stat(abs);

    let rootPath: string;
    let files: string[];
    if (st.isDirectory()) {
      rootPath = abs;
      files = await walkMarkdown(abs);
    } else {
      rootPath = dirname(abs);
      files = [abs];
    }

    const chunkMode: ChunkMode = opts.splitHeadings ? 'split' : 'atomic';
    const facts: ImportedFact[] = [];

    for (const file of files) {
      const sourcePath = toSourcePath(rootPath, file);
      const content = await readFile(file, 'utf8');
      const { frontmatter } = splitFrontmatter(content);
      if (isIndexFile(sourcePath, frontmatter)) continue;
      const tags = ['markdown', ...frontmatterTags(frontmatter)];
      facts.push(...buildFacts({ content, sourcePath, sourceTool: this.tool, tags, chunkMode }));
    }

    const provenance: ProvenanceCommon = {
      importedAt: opts.importedAt,
      importBatchId: opts.importBatchId,
      adapterVersion: MARKDOWN_ADAPTER_VERSION,
    };
    if (opts.host !== undefined) provenance.host = opts.host;

    return { sourceTool: this.tool, rootPath, facts, provenance };
  }
}
