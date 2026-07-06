// Cursor source adapter (WP4 PLAN §3.3). Imports Cursor's two rule formats:
//   - `.cursor/rules/*.mdc` — modern "project rules". MDC frontmatter carries
//     { description, globs, alwaysApply }. Body is markdown (wikilinks, relative
//     md links, and Cursor `@file` references). chunkMode 'auto' (1 file = 1
//     memory unless large).
//   - `.cursorrules` — legacy repo-root plain markdown, no frontmatter.
//     chunkMode 'split' (each H2 → its own memory).
//
// WEB VERIFY (best-effort, 2026-07) — findings baked into this adapter:
//   (a) The .mdc "project rules" frontmatter keys are `description` (string),
//       `globs`, and `alwaysApply` (boolean). Current Cursor docs write `globs`
//       as a YAML list (e.g. `globs: ["src/**/*.tsx"]`); legacy/in-the-wild
//       files also use a bare/comma-separated string. This adapter tolerates a
//       YAML list, a string, or an empty/null value (empty → no globs tag).
//         Sources: https://techsy.io/en/blog/cursor-rules-guide (globs must be a
//         YAML list), https://github.com/sanjeed5/awesome-cursor-rules-mdc/blob/
//         main/cursor-rules-reference.md (three-field frontmatter example).
//   (b) Cursor DOES support `@file` references inside rule bodies (e.g.
//       `@src/templates/service-template.ts`) to pull other files into context.
//         Source: sanjeed5/awesome-cursor-rules-mdc cursor-rules-reference.md
//         ("@service-template.ts" / "@component-template.tsx" examples).
//       We extract them as `md-relative` ImportedLinks with a `path:` locator.
//       To avoid false positives on npm scopes (`@engram/pkg`) and decorators
//       (`@Component`), a token only becomes a link when it ends in a file
//       extension. `@file` paths are treated as workspace-root relative (they
//       are not resolved against the containing rule file's directory).

import { promises as fs } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { posix } from 'node:path';
import type { EdgeType } from '@engram/memory-interchange';
import { buildFacts } from './adapter-utils.js';
import { splitFrontmatter } from '../parse/frontmatter.js';
import type { ImportIR, ImportedFact, ImportedLink, SourceTool } from '../ir/types.js';
import type { ParseOptions, SourceAdapter } from '../ir/source-adapter.interface.js';

export const CURSOR_ADAPTER_VERSION = '1';

const RULES_SUBDIR = join('.cursor', 'rules');
const LEGACY_FILE = '.cursorrules';
const RELATES_TO: EdgeType = 'relates-to';

/** A discovered rule file plus which of the two Cursor formats it is. */
interface RuleFile {
  absPath: string;
  kind: 'mdc' | 'cursorrules';
}

async function statKind(p: string): Promise<'file' | 'dir' | null> {
  try {
    const s = await fs.stat(p);
    if (s.isFile()) return 'file';
    if (s.isDirectory()) return 'dir';
    return null;
  } catch {
    return null;
  }
}

/** Recursively collect `*.mdc` files under a `.cursor/rules` directory. */
async function walkMdc(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkMdc(full)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mdc')) {
      out.push(full);
    }
  }
  return out;
}

/** Classify a single file path into a RuleFile, or null if it is neither format. */
function classifyFile(absPath: string): RuleFile | null {
  const name = basename(absPath);
  if (name === LEGACY_FILE) return { absPath, kind: 'cursorrules' };
  if (name.toLowerCase().endsWith('.mdc')) return { absPath, kind: 'mdc' };
  return null;
}

/** Discover both Cursor rule formats under a project-root directory. */
async function discoverInDir(rootAbs: string): Promise<RuleFile[]> {
  const files: RuleFile[] = [];
  const legacy = join(rootAbs, LEGACY_FILE);
  if ((await statKind(legacy)) === 'file') files.push({ absPath: legacy, kind: 'cursorrules' });

  const rulesDir = join(rootAbs, RULES_SUBDIR);
  if ((await statKind(rulesDir)) === 'dir') {
    for (const mdc of await walkMdc(rulesDir)) files.push({ absPath: mdc, kind: 'mdc' });
  }
  files.sort((a, b) => a.absPath.localeCompare(b.absPath));
  return files;
}

/** True when a `globs` frontmatter value names at least one non-empty pattern. */
function hasGlobs(frontmatter: Record<string, unknown> | undefined): boolean {
  const g = frontmatter?.['globs'];
  if (Array.isArray(g)) return g.some((x) => typeof x === 'string' && x.trim().length > 0);
  if (typeof g === 'string') return g.trim().length > 0;
  return false;
}

/** Base + frontmatter-derived tags for a `.mdc` rule file. */
function deriveMdcTags(frontmatter: Record<string, unknown> | undefined): string[] {
  const tags = ['cursor', 'rules'];
  if (frontmatter?.['alwaysApply'] === true) tags.push('always-apply');
  if (hasGlobs(frontmatter)) tags.push('globs-scoped');
  return tags;
}

// `@file` reference: `@` at a word boundary followed by a path token. Only
// tokens ending in a file extension become links (see header note (b)).
const AT_FILE_RE = /(?:^|[\s(])@([A-Za-z0-9._\-/]+)/g;
const FILE_EXT_RE = /\.[A-Za-z0-9]+$/;

/** Extract Cursor `@file` references from a body as `path:` md-relative links. */
function extractAtFileLinks(body: string): ImportedLink[] {
  const out: ImportedLink[] = [];
  const seen = new Set<string>();
  AT_FILE_RE.lastIndex = 0;
  for (const m of body.matchAll(AT_FILE_RE)) {
    const raw = (m[1] ?? '').replace(/[^A-Za-z0-9]+$/, ''); // strip trailing punctuation
    if (raw.length === 0 || !FILE_EXT_RE.test(raw)) continue;
    const normalized = posix.normalize(raw).replace(/^\.\//, '');
    const locator = `path:${normalized}`;
    if (seen.has(locator)) continue;
    seen.add(locator);
    out.push({
      kind: 'md-relative',
      rawTarget: `@${raw}`,
      targetLocator: locator,
      relType: RELATES_TO,
    });
  }
  return out;
}

/** Merge `@file` links into a fact's existing links, deduped by (rel, locator). */
function appendAtFileLinks(fact: ImportedFact): void {
  const seen = new Set(fact.links.map((l) => `${l.relType} ${l.targetLocator}`));
  for (const link of extractAtFileLinks(fact.content)) {
    const key = `${link.relType} ${link.targetLocator}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fact.links.push(link);
  }
}

/** POSIX-relative path from `rootAbs` to `absFile`. */
function toSourcePath(rootAbs: string, absFile: string): string {
  return relative(rootAbs, absFile).split(sep).join('/');
}

export class CursorAdapter implements SourceAdapter {
  readonly tool: SourceTool = 'cursor';

  async detect(path: string): Promise<boolean> {
    const abs = resolve(path);
    const kind = await statKind(abs);
    if (kind === 'file') return classifyFile(abs) !== null;
    if (kind === 'dir') {
      if ((await statKind(join(abs, LEGACY_FILE))) === 'file') return true;
      const rulesDir = join(abs, RULES_SUBDIR);
      if ((await statKind(rulesDir)) === 'dir') return (await walkMdc(rulesDir)).length > 0;
    }
    return false;
  }

  async parse(path: string, opts: ParseOptions): Promise<ImportIR> {
    const abs = resolve(path);
    const kind = await statKind(abs);

    let rootAbs: string;
    let ruleFiles: RuleFile[];
    if (kind === 'file') {
      // Single file: IR root is its dirname, sourcePath is the basename.
      rootAbs = dirname(abs);
      const classified = classifyFile(abs);
      ruleFiles = classified ? [classified] : [];
    } else {
      rootAbs = abs;
      ruleFiles = await discoverInDir(abs);
    }

    const facts: ImportedFact[] = [];
    for (const file of ruleFiles) {
      const content = await fs.readFile(file.absPath, 'utf8');
      const sourcePath = toSourcePath(rootAbs, file.absPath);

      if (file.kind === 'mdc') {
        const { frontmatter } = splitFrontmatter(content);
        const built = buildFacts({
          content,
          sourcePath,
          sourceTool: this.tool,
          tags: deriveMdcTags(frontmatter),
          chunkMode: 'auto',
        });
        for (const fact of built) appendAtFileLinks(fact);
        facts.push(...built);
      } else {
        const built = buildFacts({
          content,
          sourcePath,
          sourceTool: this.tool,
          tags: ['cursor', 'rules'],
          chunkMode: 'split',
        });
        for (const fact of built) appendAtFileLinks(fact);
        facts.push(...built);
      }
    }

    return {
      sourceTool: this.tool,
      rootPath: rootAbs,
      facts,
      provenance: {
        importedAt: opts.importedAt,
        importBatchId: opts.importBatchId,
        ...(opts.host !== undefined ? { host: opts.host } : {}),
        adapterVersion: CURSOR_ADAPTER_VERSION,
      },
    };
  }
}
