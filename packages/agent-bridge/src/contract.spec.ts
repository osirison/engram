import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Drift guard for the Agent Memory Contract (T1). The contract doc and every
 * agent's directive block name specific ENGRAM tools. If a tool is renamed
 * server-side and the doc is not updated, agents would be told to call a tool
 * that no longer exists. This test fails when the contract references a tool
 * name that is not present in the server's tool registrations.
 */

function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate repo root (pnpm-workspace.yaml)');
}

function sectionBetweenHeadings(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  if (start === -1) return '';
  const rest = markdown.slice(start + heading.length);
  const next = rest.indexOf('\n## ');
  return next === -1 ? rest : rest.slice(0, next);
}

const root = findRepoRoot();
const contract = readFileSync(join(root, 'docs', 'agent-memory-contract.md'), 'utf8');
const serverSource =
  readFileSync(join(root, 'apps', 'mcp-server', 'src', 'memory', 'memory.controller.ts'), 'utf8') +
  // Memory tool names live in the shared manifest the controller consumes (WP6
  // T4); scan it too so the drift guard still sees every registered tool.
  readFileSync(join(root, 'apps', 'mcp-server', 'src', 'memory', 'tools-manifest.ts'), 'utf8') +
  readFileSync(
    join(root, 'apps', 'mcp-server', 'src', 'api-keys', 'api-keys.controller.ts'),
    'utf8'
  );

describe('Agent Memory Contract — tool drift guard', () => {
  const toolTable = sectionBetweenHeadings(contract, '## Tools agents may use');
  const referencedTools = [...toolTable.matchAll(/^\|\s*`([a-z_]+)`/gm)].map((m) => m[1]!);

  it('lists the expected agent-facing tools in the contract table', () => {
    expect(referencedTools).toEqual(
      expect.arrayContaining(['remember', 'recall', 'load_context', 'prompt_context', 'forget'])
    );
  });

  it('every tool named in the contract is registered by the server', () => {
    for (const tool of referencedTools) {
      expect(
        serverSource.includes(`'${tool}'`) || serverSource.includes(`"${tool}"`),
        `contract references tool \`${tool}\` which is not present in the server tool registrations`
      ).toBe(true);
    }
  });

  it('the directive block still drives the recall/store loop', () => {
    // The directive block is a fenced ```markdown block (which itself contains a
    // `## ...` heading), so extract the fence content rather than splitting on headings.
    const after = contract.slice(contract.indexOf('## Directive block'));
    const fenceStart = after.indexOf('```markdown');
    const fenceEnd = after.indexOf('```', fenceStart + '```markdown'.length);
    const directive = fenceStart === -1 || fenceEnd === -1 ? '' : after.slice(fenceStart, fenceEnd);
    // Match the opening backtick + tool name so `recall <query>` counts as `recall`.
    for (const tool of ['load_context', 'recall', 'remember']) {
      expect(directive, `directive block no longer mentions \`${tool}\``).toContain(`\`${tool}`);
    }
    expect(directive).toContain('userId "qp"');
  });
});
