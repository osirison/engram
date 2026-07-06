// Claude Code source adapter (WP4 PLAN §3.1). Understands two on-disk layouts:
//   1. AUTO-MEMORY dir — `memory/MEMORY.md` is a human INDEX (discovery only,
//      NOT imported); every other `memory/*.md` is one atomic fact carrying
//      `{ name, description, metadata:{ node_type, type, originSessionId } }`
//      frontmatter and inline `[[wikilinks]]`. Tags: ['claude-code', <type>].
//   2. BARE INSTRUCTIONS — a `CLAUDE.md` / `CLAUDE.local.md` file (project or
//      user-global) H2-chunked into per-section facts tagged 'instructions'.
// Filesystem-in / IR-out, no DB access (D1); the shared `buildFacts` flow does
// frontmatter split + chunking + link extraction so output stays byte-consistent
// with every other adapter.

import { promises as fs } from 'node:fs';
import { posix, resolve, relative, dirname, basename, join, sep } from 'node:path';
import { buildFacts } from './adapter-utils.js';
import { splitFrontmatter } from '../parse/frontmatter.js';
import type { ParseOptions, SourceAdapter } from '../ir/source-adapter.interface.js';
import type { ImportIR, ImportedFact, ProvenanceCommon, SourceTool } from '../ir/types.js';

/** Bumped when the fact-mapping contract for this source changes. */
export const CLAUDE_CODE_ADAPTER_VERSION = '1';

const MEMORY_INDEX = 'MEMORY.md';
const INSTRUCTION_FILES = ['CLAUDE.md', 'CLAUDE.local.md'] as const;

/** True when `p` exists (file or dir), false on any access error. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** POSIX path of `filePath` relative to `rootPath` (the sourcePath contract). */
function toPosixRel(rootPath: string, filePath: string): string {
  const rel = relative(rootPath, filePath);
  return rel.split(sep).join(posix.sep);
}

/** `frontmatter.metadata.type` when it is a non-empty string, else undefined. */
function readMetadataType(frontmatter: Record<string, unknown> | undefined): string | undefined {
  const meta = frontmatter?.['metadata'];
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return undefined;
  const type = (meta as Record<string, unknown>)['type'];
  if (typeof type === 'string' && type.trim().length > 0) return type.trim();
  return undefined;
}

export class ClaudeCodeAdapter implements SourceAdapter {
  readonly tool: SourceTool = 'claude-code';

  async detect(path: string): Promise<boolean> {
    const abs = resolve(path);
    const stat = await fs.stat(abs).catch(() => null);
    if (stat === null) return false;
    if (stat.isFile()) {
      return (INSTRUCTION_FILES as readonly string[]).includes(basename(abs));
    }
    if (await pathExists(join(abs, 'memory', MEMORY_INDEX))) return true;
    for (const name of INSTRUCTION_FILES) {
      if (await pathExists(join(abs, name))) return true;
    }
    return false;
  }

  async parse(path: string, opts: ParseOptions): Promise<ImportIR> {
    const abs = resolve(path);
    const stat = await fs.stat(abs);

    if (stat.isFile()) {
      // A file passed directly (e.g. a project CLAUDE.md) → its dir is the root.
      return this.parseInstructions(dirname(abs), basename(abs), opts);
    }

    // Directory: auto-memory layout wins over a bare CLAUDE.md when both exist.
    if (await pathExists(join(abs, 'memory', MEMORY_INDEX))) {
      return this.parseAutoMemory(abs, opts);
    }
    for (const name of INSTRUCTION_FILES) {
      if (await pathExists(join(abs, name))) {
        return this.parseInstructions(abs, name, opts);
      }
    }
    throw new Error(
      `Not a Claude Code source: ${abs} (expected memory/${MEMORY_INDEX} or a ${INSTRUCTION_FILES.join('/')})`
    );
  }

  /** Every `memory/*.md` except the `MEMORY.md` index → one atomic fact each. */
  private async parseAutoMemory(rootPath: string, opts: ParseOptions): Promise<ImportIR> {
    const memoryDir = join(rootPath, 'memory');
    const entries = await fs.readdir(memoryDir);
    const factFiles = entries
      .filter((n) => /\.md$/i.test(n) && n.toLowerCase() !== MEMORY_INDEX.toLowerCase())
      .sort();

    const facts: ImportedFact[] = [];
    for (const name of factFiles) {
      const filePath = join(memoryDir, name);
      const content = await fs.readFile(filePath, 'utf8');
      const { frontmatter } = splitFrontmatter(content);
      const tags = ['claude-code'];
      const type = readMetadataType(frontmatter);
      if (type) tags.push(type);
      facts.push(
        ...buildFacts({
          content,
          sourcePath: toPosixRel(rootPath, filePath),
          sourceTool: this.tool,
          tags,
          chunkMode: 'atomic',
        })
      );
    }
    return this.toIR(rootPath, facts, opts);
  }

  /** One `CLAUDE.md` / `CLAUDE.local.md` → per-H2-section instruction facts. */
  private async parseInstructions(
    rootPath: string,
    fileName: string,
    opts: ParseOptions
  ): Promise<ImportIR> {
    const content = await fs.readFile(join(rootPath, fileName), 'utf8');
    const facts = buildFacts({
      content,
      sourcePath: toPosixRel(rootPath, join(rootPath, fileName)),
      sourceTool: this.tool,
      tags: ['claude-code', 'instructions'],
      chunkMode: 'split',
    });
    return this.toIR(rootPath, facts, opts);
  }

  private toIR(rootPath: string, facts: ImportedFact[], opts: ParseOptions): ImportIR {
    const provenance: ProvenanceCommon = {
      importedAt: opts.importedAt,
      importBatchId: opts.importBatchId,
      adapterVersion: CLAUDE_CODE_ADAPTER_VERSION,
    };
    if (opts.host !== undefined) provenance.host = opts.host;
    return { sourceTool: this.tool, rootPath, facts, provenance };
  }
}
