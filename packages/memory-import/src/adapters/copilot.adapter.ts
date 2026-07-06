// GitHub Copilot source adapter (WP4 PLAN §3.2). Imports the two Copilot
// instruction layouts under a repo's `.github/`:
//   - `.github/copilot-instructions.md`      — repo-wide, monolithic → H2 split
//   - `.github/instructions/*.instructions.md` — path-scoped, 1-file-1-memory
//     (auto: split only when large + multi-H2); its YAML frontmatter may carry
//     `applyTo` (a glob) which becomes a derived `applies:<slug>` tag.
// Filesystem-in / IR-out, no DB access (SourceAdapter contract, T1).

import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, posix, resolve, sep } from 'node:path';
import { slugify } from '@engram/memory-interchange';
import { splitFrontmatter } from '../parse/frontmatter.js';
import { buildFacts } from './adapter-utils.js';
import type { ImportIR, ImportedFact, ProvenanceCommon, SourceTool } from '../ir/types.js';
import type { ParseOptions, SourceAdapter } from '../ir/source-adapter.interface.js';

export const COPILOT_ADAPTER_VERSION = '1';

/** Tags every Copilot fact carries. */
const BASE_TAGS: readonly string[] = ['copilot', 'instructions'];
/** Repo-wide instruction filename (inside `.github/`). */
const REPO_WIDE_FILE = 'copilot-instructions.md';
/** Directory (inside `.github/`) holding path-scoped instruction files. */
const INSTRUCTIONS_DIR = 'instructions';
/** Suffix marking a path-scoped instruction file. */
const SCOPED_SUFFIX = '.instructions.md';

type FileKind = 'repo' | 'scoped';

interface DiscoveredFile {
  abs: string;
  kind: FileKind;
}

/** Convert a platform path to POSIX separators for stable `sourcePath`s. */
function toPosix(p: string): string {
  return p.split(sep).join(posix.sep);
}

/** `sourcePath` = POSIX path of `file` relative to the IR `rootPath`. */
function relPosix(rootPath: string, file: string): string {
  return posix.relative(toPosix(rootPath), toPosix(file));
}

async function isFilePath(p: string): Promise<boolean> {
  const st = await stat(p).catch(() => null);
  return st?.isFile() ?? false;
}

async function isDirPath(p: string): Promise<boolean> {
  const st = await stat(p).catch(() => null);
  return st?.isDirectory() ?? false;
}

/** A scoped file's `applyTo` glob → `applies:<slug>` tag, when present. */
function deriveApplyToTag(content: string): string | null {
  const { frontmatter } = splitFrontmatter(content);
  const applyTo = frontmatter?.['applyTo'];
  if (typeof applyTo !== 'string') return null;
  const trimmed = applyTo.trim();
  if (trimmed.length === 0) return null;
  const slug = slugify(trimmed);
  return `applies:${slug}`;
}

export class CopilotAdapter implements SourceAdapter {
  readonly tool: SourceTool = 'copilot';

  async detect(path: string): Promise<boolean> {
    const abs = resolve(path);
    // A single instruction file passed directly.
    if (abs.endsWith(SCOPED_SUFFIX) || basename(abs) === REPO_WIDE_FILE) {
      return isFilePath(abs);
    }
    // A repo/dir containing the Copilot layout.
    const githubDir = join(abs, '.github');
    if (await isFilePath(join(githubDir, REPO_WIDE_FILE))) return true;
    if (await isDirPath(join(githubDir, INSTRUCTIONS_DIR))) return true;
    return false;
  }

  async parse(path: string, opts: ParseOptions): Promise<ImportIR> {
    const abs = resolve(path);
    const singleFile = await isFilePath(abs);

    const rootPath = singleFile ? dirname(abs) : abs;
    const files = singleFile ? this.discoverSingle(abs) : await this.discoverDir(abs);

    const facts: ImportedFact[] = [];
    for (const file of files) {
      const content = await readFile(file.abs, 'utf8');
      const sourcePath = relPosix(rootPath, file.abs);
      if (file.kind === 'repo') {
        facts.push(
          ...buildFacts({
            content,
            sourcePath,
            sourceTool: this.tool,
            tags: [...BASE_TAGS],
            chunkMode: 'split',
          })
        );
      } else {
        const tags = [...BASE_TAGS];
        const applyTag = deriveApplyToTag(content);
        if (applyTag) tags.push(applyTag);
        facts.push(
          ...buildFacts({
            content,
            sourcePath,
            sourceTool: this.tool,
            tags,
            chunkMode: 'auto',
          })
        );
      }
    }

    const provenance: ProvenanceCommon = {
      importedAt: opts.importedAt,
      importBatchId: opts.importBatchId,
      adapterVersion: COPILOT_ADAPTER_VERSION,
    };
    if (opts.host !== undefined) provenance.host = opts.host;

    return { sourceTool: this.tool, rootPath, facts, provenance };
  }

  private discoverSingle(abs: string): DiscoveredFile[] {
    const kind: FileKind = abs.endsWith(SCOPED_SUFFIX) ? 'scoped' : 'repo';
    return [{ abs, kind }];
  }

  private async discoverDir(abs: string): Promise<DiscoveredFile[]> {
    const files: DiscoveredFile[] = [];
    const githubDir = join(abs, '.github');

    const repoWide = join(githubDir, REPO_WIDE_FILE);
    if (await isFilePath(repoWide)) files.push({ abs: repoWide, kind: 'repo' });

    const instrDir = join(githubDir, INSTRUCTIONS_DIR);
    const entries = await readdir(instrDir).catch(() => [] as string[]);
    for (const name of entries.slice().sort()) {
      if (!name.endsWith(SCOPED_SUFFIX)) continue;
      const fp = join(instrDir, name);
      if (await isFilePath(fp)) files.push({ abs: fp, kind: 'scoped' });
    }
    return files;
  }
}
