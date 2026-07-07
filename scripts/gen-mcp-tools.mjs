#!/usr/bin/env node
// AUTO-GENERATOR — writes apps/docs/src/content/docs/reference/mcp-tools/*.md
//
// MCP tool reference generator (WP6 T4). Imports the *compiled* single source
// of truth — `TOOL_MANIFEST` (apps/mcp-server) and `pingTool`/`zodToJsonSchema`
// (@engram/core) — so the reference cannot drift from what the server
// registers. Requires a prior `pnpm build` (schemas resolve to package `dist/`).
//
// Determinism (D3): output must be byte-for-byte identical across runs — no
// timestamps, run ids, or filesystem-order-dependent content. z.toJSONSchema
// preserves the Zod object's declared field order, which is stable.

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const manifestPath = join(repoRoot, 'apps/mcp-server/dist/memory/tools-manifest.js');
const corePath = join(repoRoot, 'packages/core/dist/index.js');

// This generator rm -rf's the output directory before rewriting it, and the
// path is overridable via env — so refuse anything that isn't safely inside the
// repo (the default) or the OS temp dir (tests), and never the repo root itself.
const outDir = resolve(
  process.env.GEN_MCP_TOOLS_OUT ?? join(repoRoot, 'apps/docs/src/content/docs/reference/mcp-tools')
);
const underRepo = outDir.startsWith(repoRoot + sep);
const underTmp = outDir.startsWith(resolve(tmpdir()) + sep);
if (outDir === repoRoot || (!underRepo && !underTmp)) {
  process.stderr.write(
    `gen-mcp-tools: refusing to write/delete ${outDir} — it must be inside the repo or a temp dir.\n`
  );
  process.exit(1);
}

if (!existsSync(manifestPath) || !existsSync(corePath)) {
  process.stderr.write(
    'gen-mcp-tools: compiled sources not found. Run `pnpm build` first ' +
      '(the tool schemas resolve to package dist/).\n'
  );
  process.exit(1);
}

const { TOOL_MANIFEST } = require(manifestPath);
const { zodToJsonSchema, pingTool } = require(corePath);

/** Tools to document: ping (core) first, then the memory manifest in order. */
const tools = [pingTool, ...TOOL_MANIFEST];

const slug = (name) => name.replace(/_/g, '-');
const authMode = (t) => t.auth ?? 'identity';

function escapeCell(text) {
  return String(text).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim();
}

/** Double-quoted YAML scalar, safe for descriptions containing `:` etc. */
function yamlString(text) {
  return `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n+/g, ' ').trim()}"`;
}

/** Human-readable type for a JSON-schema property node. */
function renderType(prop) {
  if (!prop || typeof prop !== 'object') return 'unknown';
  if (Array.isArray(prop.enum)) {
    return prop.enum.map((v) => `\`${v}\``).join(' \\| ');
  }
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(prop[key])) {
      return [...new Set(prop[key].map(renderType))].join(' \\| ');
    }
  }
  if (prop.type === 'array') {
    return `${renderType(prop.items ?? {})}[]`;
  }
  if (Array.isArray(prop.type)) return prop.type.join(' \\| ');
  return prop.type ?? 'object';
}

/** A deterministic placeholder value for an example argument. */
function exampleValue(name, prop) {
  if (name === 'userId') return 'qp';
  if (prop && Array.isArray(prop.enum)) return prop.enum[0];
  const type = Array.isArray(prop?.type) ? prop.type[0] : prop?.type;
  switch (type) {
    case 'number':
    case 'integer':
      return typeof prop.minimum === 'number' ? prop.minimum : 0;
    case 'boolean':
      return true;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return `<${name}>`;
  }
}

function toolPage(tool) {
  const schema = zodToJsonSchema(tool.inputSchema);
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const paramNames = Object.keys(properties);

  const lines = [];
  lines.push('---');
  lines.push(`title: ${yamlString(tool.name)}`);
  lines.push(`description: ${yamlString(tool.description)}`);
  lines.push('---');
  lines.push('');
  lines.push('<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->');
  lines.push('');
  lines.push(tool.description);
  lines.push('');

  // Auth metadata.
  lines.push(`**Auth mode:** \`${authMode(tool)}\`  `);
  if (tool.requiredScope) {
    lines.push(`**Required scope:** \`${tool.requiredScope}\`  `);
  }
  if (authMode(tool) === 'admin') {
    lines.push('**Admin tool:** requires `MCP_ADMIN_TOKEN`.  ');
  }
  if (tool.delegable) {
    lines.push(
      '**Delegable:** an `admin`-scoped key may act on another tenant by passing an explicit `userId`.  '
    );
  }
  lines.push('');

  // Parameter table.
  lines.push('## Input parameters');
  lines.push('');
  if (paramNames.length === 0) {
    lines.push('This tool takes no input parameters.');
    lines.push('');
  } else {
    lines.push('| Parameter | Type | Required | Default | Description |');
    lines.push('| --------- | ---- | -------- | ------- | ----------- |');
    for (const name of paramNames) {
      const prop = properties[name];
      const def = prop && 'default' in prop ? `\`${JSON.stringify(prop.default)}\`` : '—';
      const desc = prop?.description ? escapeCell(prop.description) : '—';
      lines.push(
        `| \`${name}\` | ${renderType(prop)} | ${required.has(name) ? 'yes' : 'no'} | ${def} | ${desc} |`
      );
    }
    lines.push('');
  }

  // Example call.
  const args = {};
  for (const name of paramNames) {
    if (required.has(name)) args[name] = exampleValue(name, properties[name]);
  }
  lines.push('## Example');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify({ name: tool.name, arguments: args }, null, 2));
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

function indexPage() {
  const lines = [];
  lines.push('---');
  lines.push('title: MCP tools');
  lines.push(
    'description: Every MCP tool the Engram server registers, with its auth mode and required scope.'
  );
  lines.push('---');
  lines.push('');
  lines.push('<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->');
  lines.push('');
  lines.push(`Engram registers **${tools.length} MCP tools**. Availability is further`);
  lines.push('narrowed by the active deployment profile (the queue/reindex maintenance');
  lines.push('tools require the enterprise profile).');
  lines.push('');
  lines.push('| Tool | Auth | Scope | Description |');
  lines.push('| ---- | ---- | ----- | ----------- |');
  for (const tool of tools) {
    lines.push(
      `| [\`${tool.name}\`](./${slug(tool.name)}) | \`${authMode(tool)}\` | ${
        tool.requiredScope ? `\`${tool.requiredScope}\`` : '—'
      } | ${escapeCell(tool.description)} |`
    );
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  // Rebuild the directory from scratch so a removed tool leaves no stale page.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  writeFileSync(join(outDir, 'index.md'), indexPage());
  for (const tool of tools) {
    writeFileSync(join(outDir, `${slug(tool.name)}.md`), toolPage(tool));
  }
  process.stdout.write(`gen-mcp-tools: wrote index + ${tools.length} tool pages to ${outDir}\n`);
}

main();
