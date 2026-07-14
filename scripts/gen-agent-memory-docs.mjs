#!/usr/bin/env node
// AUTO-GENERATOR — writes apps/docs/src/content/docs/agent-memory/*.mdx
//
// The five agent-memory docs are canonical at docs/agent-memory-*.md — AI
// agents (AGENTS.md, CLAUDE.md) read that repo copy directly at runtime, so
// it cannot move. This script derives the published site mirror from that
// source so the two can never drift out of sync by hand-editing. The only
// real transformation is link rewriting: a relative link that resolves fine
// in the repo (`./security/agent-keys.md`) has no meaning on the site, so it
// is mapped to the page it now lives on, or to a GitHub blob/tree URL when
// there is no site page for it. Everything else — frontmatter title, prose,
// tables — is reused verbatim.
//
// Determinism (D3): output must be byte-for-byte identical across runs.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, posix } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const srcDir = join(repoRoot, 'docs');
const outDir = join(repoRoot, 'apps/docs/src/content/docs/agent-memory');

const GITHUB_BLOB_BASE = 'https://github.com/osirison/engram/blob/main/';
const GITHUB_TREE_BASE = 'https://github.com/osirison/engram/tree/main/';

// One entry per mirrored doc. `kind` fills the "canonical copy of this ___
// lives in the repository at" banner sentence; `sidebar` matches the site's
// existing nav order/labels for this section.
const DOCS = [
  { slug: 'contract', file: 'agent-memory-contract.md', kind: 'contract', sidebar: { order: 1, label: 'Contract' } },
  { slug: 'server', file: 'agent-memory-server.md', kind: 'runbook', sidebar: { order: 2, label: 'Server' } },
  { slug: 'clients', file: 'agent-memory-clients.md', kind: 'guide', sidebar: { order: 3, label: 'Clients' } },
  { slug: 'sync', file: 'agent-memory-sync.md', kind: 'guide', sidebar: { order: 4, label: 'Sync' } },
  { slug: 'migration', file: 'agent-memory-migration.md', kind: 'runbook', sidebar: { order: 5, label: 'Migration' } },
];
const SIBLING_SLUGS = new Set(DOCS.map((d) => d.slug));

// Repo-relative link targets that were themselves migrated to the docs site
// (WP6) under a path the mechanical `agent-memory-X.md -> /docs/agent-memory/X/`
// rule below cannot derive. SETUP.md now redirects to several site pages
// depending on which part of it is referenced; every reference here maps to
// the general getting-started index rather than guessing the specific one.
const INTERNAL_LINK_MAP = {
  'security/agent-keys.md': '/docs/how-to/provision-agent-keys/',
  'IMPORT.md': '/docs/how-to/import-agent-memory/',
  'RELEASE_GATES.md': '/docs/reference/release-gates/',
  'deploy.md': '/docs/how-to/deploy-production/',
  'SETUP.md': '/docs/getting-started/',
};

function isExternalOrSameDoc(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#');
}

function rewriteLink(target) {
  if (isExternalOrSameDoc(target)) return target;

  const [pathPart, hash = ''] = target.split('#');
  const anchor = hash ? `#${hash}` : '';
  const clean = pathPart.replace(/^\.\//, '');

  const siblingMatch = clean.match(/^agent-memory-([a-z]+)\.md$/);
  if (siblingMatch && SIBLING_SLUGS.has(siblingMatch[1])) {
    return `/docs/agent-memory/${siblingMatch[1]}/${anchor}`;
  }

  if (clean in INTERNAL_LINK_MAP) return `${INTERNAL_LINK_MAP[clean]}${anchor}`;

  // Fallback: anything else repo-relative (scripts, compose files, package
  // dirs, systemd units) has no site page — link to it on GitHub instead.
  const resolved = posix.normalize(posix.join('docs', pathPart));
  const base = /\.[a-z0-9]+$/i.test(resolved) ? GITHUB_BLOB_BASE : GITHUB_TREE_BASE;
  return `${base}${resolved}${anchor}`;
}

function transformLinks(body) {
  return body.replace(/(\]\()([^)\s]+)(\))/g, (full, open, target, close) => {
    return `${open}${rewriteLink(target)}${close}`;
  });
}

for (const doc of DOCS) {
  const raw = readFileSync(join(srcDir, doc.file), 'utf8');
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) throw new Error(`gen-agent-memory-docs: ${doc.file} is missing frontmatter`);

  const frontmatter = fmMatch[1];
  const title = frontmatter.match(/^title:\s*(.+)$/m)?.[1];
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.replace(/\.?$/, '.');
  if (!title || !description) {
    throw new Error(`gen-agent-memory-docs: ${doc.file} is missing title/description frontmatter`);
  }

  // The root file opens its body with its own "Also published at ..." banner
  // and an `# H1` heading. The site derives the page title from frontmatter
  // and needs the opposite-direction banner, so both are dropped here.
  const openingPattern = /^\n> Also published at [^\n]*\n\n# [^\n]+\n\n/;
  if (!openingPattern.test(raw.slice(fmMatch[0].length))) {
    throw new Error(`gen-agent-memory-docs: ${doc.file} does not match the expected opening banner/heading shape`);
  }
  const body = raw.slice(fmMatch[0].length).replace(openingPattern, '');

  const banner =
    `> The canonical copy of this ${doc.kind} lives in the repository at\n` +
    `> [\`docs/${doc.file}\`](${GITHUB_BLOB_BASE}docs/${doc.file}) —\n` +
    `> agents read it from the repo at runtime. This page is a published mirror.\n`;

  const out =
    `---\n` +
    `title: ${title}\n` +
    `description: ${description}\n` +
    `sidebar:\n` +
    `  order: ${doc.sidebar.order}\n` +
    `  label: ${doc.sidebar.label}\n` +
    `---\n\n` +
    `${banner}\n` +
    transformLinks(body);

  writeFileSync(join(outDir, `${doc.slug}.mdx`), out);
}
