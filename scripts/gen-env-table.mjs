#!/usr/bin/env node
// AUTO-GENERATOR — writes apps/docs/src/content/docs/reference/configuration.md
//
// Configuration reference generator (WP6 T3). Reads the Engram env schema from
// source with ts-morph — no compiled import, so it runs without building any
// package — and emits a deterministic Markdown table. Determinism (D3): the
// output must be byte-for-byte identical across runs, so nothing here emits a
// timestamp, run id, or filesystem-order-dependent content.
//
// Two sections:
//   1. Schema-validated variables — every field of `baseSchema`, with type,
//      default, required flag, profile requirement, and JSDoc description.
//   2. Additional variables — every other `process.env.*` read across apps/ and
//      packages/, discovered by scanning source (so new reads surface here and
//      the drift gate catches them), with curated descriptions where known.

import { Project, SyntaxKind } from 'ts-morph';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const schemaPath = join(repoRoot, 'packages/config/src/env.schema.ts');
const profilePath = join(repoRoot, 'packages/config/src/profile.ts');
// Output path; overridable via env so tests can target a temp file.
const outPath =
  process.env.GEN_ENV_TABLE_OUT ??
  join(repoRoot, 'apps/docs/src/content/docs/reference/configuration.md');

// Vars that are never Engram configuration (OS/process/tooling globals). These
// are excluded from Section 2 even though the scan finds `process.env` reads.
const NOISE_VARS = new Set(['HOME', 'HOST', 'PWD', 'PATH', 'CI', 'npm_lifecycle_event']);

// Curated descriptions for unvalidated `process.env` reads. A variable missing
// from this map still appears in the table (with an em dash) so nothing is
// hidden; fill it in when you add the read.
const UNVALIDATED_DOCS = {
  MCP_ADMIN_TOKEN: 'Bearer token gating every admin MCP tool. Security-critical.',
  OTEL_EXPORTER_OTLP_ENDPOINT:
    'OTLP endpoint for traces. Omit to disable OpenTelemetry (no overhead).',
  OTEL_SERVICE_NAME: 'Service name reported to OpenTelemetry.',
  LOG_LEVEL: 'Pino log level: `debug` | `info` | `warn` | `error`.',
  ALLOW_UNAUTHENTICATED_HTTP:
    'Dev-only override that allows unauthenticated streamable-http calls. Never set in production.',
  CORS_ALLOWED_ORIGINS: 'Comma-separated list of allowed CORS origins for the HTTP transport.',
  ENGRAM_DEFAULT_USER_ID: 'Fallback `userId` used when `AUTH_REQUIRED=false`.',
  ENGRAM_API_KEY: 'Pre-shared API key accepted as an alternative to a session JWT.',
  ENGRAM_ADMIN_EMAILS: 'Comma-separated list of emails granted the admin scope.',
  ENGRAM_OPERATOR_TENANTS: 'Comma-separated tenant allowlist an operator (admin) key may act on.',
  ENGRAM_MCP_URL: 'Base URL of the MCP endpoint used by clients and the dashboard.',
  ENGRAM_DASHBOARD_DEV_AUTH: 'Dev-only flag that relaxes dashboard auth for local development.',
  METRICS_TOKEN: 'Bearer token required to scrape `/health/metrics`.',
  WEB_DATABASE_URL: 'Postgres URL used by the Next.js dashboard (`apps/web`).',
  AUTH_GITHUB_ID: 'GitHub OAuth client id for the dashboard (Auth.js).',
  AUTH_GITHUB_SECRET: 'GitHub OAuth client secret for the dashboard (Auth.js).',
  AUTH_GOOGLE_ID: 'Google OAuth client id for the dashboard (Auth.js).',
  AUTH_GOOGLE_SECRET: 'Google OAuth client secret for the dashboard (Auth.js).',
  MEMORY_DUPLICATE_THRESHOLD:
    'Cosine-similarity threshold above which a new memory is treated as a duplicate.',
  MEMORY_CONTRADICTION_THRESHOLD: 'Lower similarity bound for contradiction detection.',
  MEMORY_CONTRADICTION_THRESHOLD_MAX: 'Upper similarity bound for contradiction detection.',
  MEMORY_DECAY_INTERVAL_MS: 'Interval between importance-decay ticks, in milliseconds.',
  MEMORY_IMPORTANCE_HALF_LIFE_DAYS: 'Half-life (days) for the memory importance decay curve.',
  STM_CONSOLIDATION_IMPORTANCE_THRESHOLD:
    'Minimum importance an STM memory needs to qualify for promotion.',
};

// Test-only variables that gate integration suites. Grouped separately so the
// runtime reference stays uncluttered.
const isTestOnlyVar = (name) => name.endsWith('_TEST_URL') || name === 'E2E_ENABLED';

/** Resolve `DeploymentProfile.X` member references to their string values. */
function readProfileEnum(project) {
  const src = project.addSourceFileAtPath(profilePath);
  const map = new Map();
  const enumDecl = src.getEnum('DeploymentProfile');
  if (enumDecl) {
    for (const member of enumDecl.getMembers()) {
      const value = member.getValue();
      map.set(member.getName(), typeof value === 'string' ? value : member.getName());
    }
  }
  return map;
}

/** Render a `.default(...)` / `booleanFlag(...)` argument as a display string. */
function renderDefault(text, profileEnum) {
  const t = text.trim();
  const profileMatch = t.match(/^DeploymentProfile\.(\w+)$/);
  if (profileMatch) return profileEnum.get(profileMatch[1]) ?? profileMatch[1];
  // Strip quotes and numeric separators for readability.
  return t.replace(/^['"`]|['"`]$/g, '').replace(/_(?=\d)/g, '');
}

/** Extract type / default / optional facts from a Zod field initializer node. */
function describeField(initializer, profileEnum) {
  const text = initializer.getText();
  let type = 'string';
  let defaultValue = undefined;
  let optional = false;

  // `booleanFlag(<default>)` helper.
  const boolFlag = text.match(/^booleanFlag\(\s*([^)]*)\)/);
  if (boolFlag) {
    type = 'boolean';
    if (boolFlag[1].trim().length > 0) {
      defaultValue = renderDefault(boolFlag[1], profileEnum);
    }
  }

  // Walk the call chain for enum values, `.default()`, and `.optional()`.
  // Include the initializer itself: the outermost `.default()`/`.optional()`
  // call is the node, not a descendant.
  const calls = [];
  if (initializer.getKind() === SyntaxKind.CallExpression) calls.push(initializer);
  calls.push(...initializer.getDescendantsOfKind(SyntaxKind.CallExpression));
  for (const call of calls) {
    const expr = call.getExpression();
    const name =
      expr.getKind() === SyntaxKind.PropertyAccessExpression ? expr.getName() : undefined;
    if (name === 'optional') optional = true;
    if (name === 'default') {
      const arg = call.getArguments()[0];
      if (arg) defaultValue = renderDefault(arg.getText(), profileEnum);
    }
    if (name === 'enum') {
      const arr = call.getArguments()[0];
      if (arr && arr.getKind() === SyntaxKind.ArrayLiteralExpression) {
        const values = arr.getElements().map((e) => e.getText().replace(/^['"`]|['"`]$/g, ''));
        type = values.map((v) => `\`${v}\``).join(' \\| ');
      }
    }
  }

  if (type === 'string' && !boolFlag) {
    if (/z\.coerce\.number|z\.number/.test(text)) type = 'number';
    else if (/z\.boolean/.test(text)) type = 'boolean';
    else if (/z\.string/.test(text)) type = 'string';
  }

  return { type, defaultValue, optional };
}

/** Per-field profile requirement, keyed by variable name. */
const PROFILE_REQUIREMENT = {
  JWT_SECRET: 'when `AUTH_REQUIRED=true`',
};

/** Read the block comment immediately preceding a node as plain prose. */
function extractLeadingDoc(node) {
  const ranges = node.getLeadingCommentRanges();
  if (ranges.length === 0) return '';
  const last = ranges[ranges.length - 1].getText();
  if (!last.startsWith('/*')) return '';
  return last
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/, '').trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .trim();
}

function escapeCell(text) {
  return text.replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim();
}

function main() {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false },
  });
  const profileEnum = readProfileEnum(project);
  const src = project.addSourceFileAtPath(schemaPath);

  // Locate `export const baseSchema = z.object({ ... })`.
  const baseDecl = src.getVariableDeclarationOrThrow('baseSchema');
  const objectArg = baseDecl
    .getInitializerIfKindOrThrow(SyntaxKind.CallExpression)
    .getArguments()[0];
  if (!objectArg || objectArg.getKind() !== SyntaxKind.ObjectLiteralExpression) {
    throw new Error('baseSchema initializer is not z.object({...})');
  }

  const rows = [];
  for (const prop of objectArg.getProperties()) {
    if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
    const name = prop.getName().replace(/^['"`]|['"`]$/g, '');
    const initializer = prop.getInitializerOrThrow();
    const { type, defaultValue, optional } = describeField(initializer, profileEnum);

    // Leading JSDoc / block comment is the human description. PropertyAssignment
    // is not a JSDocable node, so read the raw leading comment ranges and take
    // the last block comment (`/** ... */` or `/* ... */`) immediately above.
    const description = extractLeadingDoc(prop);

    const hasDefault = defaultValue !== undefined;
    const required = !optional && !hasDefault ? 'yes' : 'no';
    rows.push({
      name,
      type,
      default: hasDefault ? `\`${defaultValue}\`` : '—',
      required,
      profile: PROFILE_REQUIREMENT[name] ?? 'all',
      description: escapeCell(description) || '—',
    });
  }

  // Extract profile-conditional requirement messages from the transform.
  const profileNotes = src
    .getDescendantsOfKind(SyntaxKind.StringLiteral)
    .map((s) => s.getLiteralText())
    .filter((t) => /is required when|must be set|must be a valid/.test(t));
  const uniqueNotes = [...new Set(profileNotes)];

  // Section 2: scan for unvalidated process.env reads.
  const baseNames = new Set(rows.map((r) => r.name));
  const found = scanProcessEnv([join(repoRoot, 'apps'), join(repoRoot, 'packages')]);
  const extra = [...found].filter((n) => !baseNames.has(n) && !NOISE_VARS.has(n)).sort();
  const runtimeExtra = extra.filter((n) => !isTestOnlyVar(n));
  const testExtra = extra.filter((n) => isTestOnlyVar(n));

  writeFileSync(outPath, render(rows, uniqueNotes, runtimeExtra, testExtra));
  process.stdout.write(
    `gen-env-table: wrote ${rows.length} schema vars + ${runtimeExtra.length} runtime + ${testExtra.length} test-only to ${outPath}\n`
  );
}

/**
 * Collect distinct `process.env.NAME` identifiers from git-tracked source files
 * under the given roots. Enumerating via `git ls-files` (not a live filesystem
 * walk) keeps the scan deterministic: it ignores build artifacts and transient
 * files a parallel test run may create/delete mid-scan, so the output — and the
 * drift gate — depend only on committed source.
 */
function scanProcessEnv(roots) {
  const names = new Set();
  const re = /process\.env\.([A-Z][A-Z0-9_]+)/g;
  const relRoots = roots.map((r) => relative(repoRoot, r));
  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files', '-z', '--', ...relRoots], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\0')
      .filter(Boolean);
  } catch {
    tracked = [];
  }
  for (const rel of tracked) {
    if (!/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/.test(rel)) continue;
    let content;
    try {
      content = readFileSync(join(repoRoot, rel), 'utf8');
    } catch {
      continue;
    }
    let m;
    while ((m = re.exec(content)) !== null) names.add(m[1]);
  }
  return names;
}

function render(rows, notes, runtimeExtra, testExtra) {
  const lines = [];
  lines.push('---');
  lines.push('title: Configuration reference');
  lines.push(
    'description: All Engram environment variables with types, defaults, and profile requirements.'
  );
  lines.push('---');
  lines.push('');
  lines.push('<!-- AUTO-GENERATED — do not edit by hand. Run `pnpm docs:generate`. -->');
  lines.push('');
  lines.push('Engram is configured entirely through environment variables. Section 1 lists');
  lines.push('the schema-validated variables (parsed by `@engram/config`); Section 2 lists');
  lines.push('the remaining variables read directly from `process.env` elsewhere in the');
  lines.push('codebase.');
  lines.push('');
  lines.push('## Schema-validated variables');
  lines.push('');
  lines.push('| Variable | Type | Default | Required | Profile | Description |');
  lines.push('| -------- | ---- | ------- | -------- | ------- | ----------- |');
  for (const r of rows) {
    lines.push(
      `| \`${r.name}\` | ${r.type} | ${r.default} | ${r.required} | ${r.profile} | ${r.description} |`
    );
  }
  lines.push('');
  if (notes.length > 0) {
    lines.push('### Profile requirements');
    lines.push('');
    lines.push('Some variables are optional in the base schema but enforced at load time');
    lines.push('depending on the active `DEPLOYMENT_PROFILE`:');
    lines.push('');
    for (const n of notes) lines.push(`- ${escapeCell(n)}`);
    lines.push('');
  }
  lines.push('## Additional variables (not schema-validated)');
  lines.push('');
  lines.push('These are read directly from `process.env` and are **not** validated by');
  lines.push('`@engram/config`. They are discovered by scanning the source, so a new read');
  lines.push('appears here automatically (add a description in the generator).');
  lines.push('');
  lines.push('| Variable | Description |');
  lines.push('| -------- | ----------- |');
  for (const name of runtimeExtra) {
    lines.push(`| \`${name}\` | ${escapeCell(UNVALIDATED_DOCS[name] ?? '—')} |`);
  }
  lines.push('');
  if (testExtra.length > 0) {
    lines.push('### Test-only variables');
    lines.push('');
    lines.push('Set only to enable integration test suites; never required at runtime.');
    lines.push('');
    lines.push('| Variable | Description |');
    lines.push('| -------- | ----------- |');
    for (const name of testExtra) {
      lines.push(
        `| \`${name}\` | ${escapeCell(UNVALIDATED_DOCS[name] ?? 'Enables an integration test suite.')} |`
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

main();
