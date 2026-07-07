import { describe, expect, it, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { baseSchema } from './env.schema';

// Wiring-level test for `scripts/gen-env-table.mjs` (WP6 T3). Runs the real
// generator as a subprocess (so ts-morph resolves at the repo root) into a temp
// file, then asserts the emitted Markdown against `baseSchema` — the single
// source of truth the generator reads. Guards the drift gate: if a field is
// added/removed or a description goes missing, this fails before CI.
const repoRoot = resolve(__dirname, '../../..');
const script = join(repoRoot, 'scripts/gen-env-table.mjs');
const fieldNames = Object.keys(baseSchema.shape);

function generate(outPath: string): string {
  execFileSync('node', [script], {
    cwd: repoRoot,
    env: { ...process.env, GEN_ENV_TABLE_OUT: outPath },
    stdio: 'pipe',
  });
  return readFileSync(outPath, 'utf8');
}

describe('gen-env-table', () => {
  let markdown: string;

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'engram-envtable-'));
    markdown = generate(join(dir, 'configuration.md'));
  });

  it('emits one schema-validated row per baseSchema field', () => {
    for (const name of fieldNames) {
      expect(markdown, `missing row for ${name}`).toContain(`| \`${name}\` |`);
    }
    // Guard against extra/dropped rows: count table rows in section 1.
    const section1 = markdown
      .split('## Additional variables')[0]
      .split('\n')
      .filter((l) => /^\| `[A-Z]/.test(l));
    expect(section1).toHaveLength(fieldNames.length);
  });

  it('gives every schema-validated field a non-empty description (R3)', () => {
    const missing: string[] = [];
    for (const name of fieldNames) {
      const row = markdown.split('\n').find((l) => l.startsWith(`| \`${name}\` |`));
      expect(row, `no row for ${name}`).toBeTruthy();
      const description = row!.split('|').at(-2)?.trim();
      if (!description || description === '—') missing.push(name);
    }
    expect(missing, `fields without a description: ${missing.join(', ')}`).toEqual([]);
  });

  it('records profile requirements for the conditional URL fields', () => {
    const dbRow = markdown.split('\n').find((l) => l.startsWith('| `DATABASE_URL` |'));
    expect(dbRow).toMatch(/lite/);
    expect(dbRow).toMatch(/enterprise/);
  });

  it('includes the unvalidated process.env section with security-critical vars', () => {
    expect(markdown).toContain('## Additional variables (not schema-validated)');
    expect(markdown).toContain('`MCP_ADMIN_TOKEN`');
  });

  it('is deterministic across runs (drift-gate premise)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'engram-envtable-det-'));
    const a = generate(join(dir, 'a.md'));
    const b = generate(join(dir, 'b.md'));
    expect(a).toEqual(b);
  });
});
