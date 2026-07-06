import { describe, it, expect } from 'vitest';
import { splitFrontmatter } from './frontmatter.js';

describe('splitFrontmatter', () => {
  it('returns the whole input as body when there is no frontmatter', () => {
    const { frontmatter, body } = splitFrontmatter('# Title\n\nJust content.');
    expect(frontmatter).toBeUndefined();
    expect(body).toBe('# Title\n\nJust content.');
  });

  it('parses a valid YAML frontmatter block and strips it from the body', () => {
    const raw = '---\nname: feedback-worktree\ndescription: use a worktree\n---\nBody text here.';
    const { frontmatter, body } = splitFrontmatter(raw);
    expect(frontmatter).toEqual({ name: 'feedback-worktree', description: 'use a worktree' });
    expect(body).toBe('Body text here.');
  });

  it('parses nested metadata (Claude auto-memory shape)', () => {
    const raw = [
      '---',
      'name: feedback-worktree',
      'description: always use a worktree',
      'metadata:',
      '  node_type: memory',
      '  type: feedback',
      '---',
      'Body.',
    ].join('\n');
    const { frontmatter } = splitFrontmatter(raw);
    expect(frontmatter?.['metadata']).toEqual({ node_type: 'memory', type: 'feedback' });
  });

  it('treats an empty frontmatter block as no frontmatter', () => {
    const { frontmatter, body } = splitFrontmatter('---\n---\nrest');
    expect(frontmatter).toBeUndefined();
    expect(body).toBe('rest');
  });

  it('tolerates malformed YAML by keeping the original content intact', () => {
    const raw = '---\n: : : not: valid: yaml:\n---\nbody';
    const { frontmatter, body } = splitFrontmatter(raw);
    expect(frontmatter).toBeUndefined();
    expect(body).toBe(raw);
  });

  it('ignores a scalar/array frontmatter (not a mapping)', () => {
    const { frontmatter } = splitFrontmatter('---\njust a string\n---\nbody');
    expect(frontmatter).toBeUndefined();
  });

  it('parses MDC (Cursor) frontmatter with the same fence', () => {
    const raw = '---\ndescription: rule\nglobs:\nalwaysApply: true\n---\nRule body.';
    const { frontmatter, body } = splitFrontmatter(raw);
    expect(frontmatter).toEqual({ description: 'rule', globs: null, alwaysApply: true });
    expect(body).toBe('Rule body.');
  });

  it('normalizes CRLF line endings before splitting', () => {
    const { frontmatter, body } = splitFrontmatter('---\r\nname: x\r\n---\r\nbody\r\nline2');
    expect(frontmatter).toEqual({ name: 'x' });
    expect(body).toBe('body\nline2');
  });

  it('does not mistake a body `---` for the closing fence', () => {
    const raw = '---\nname: x\n---\nintro\n\n---\n\nmore';
    const { frontmatter, body } = splitFrontmatter(raw);
    expect(frontmatter).toEqual({ name: 'x' });
    expect(body).toBe('intro\n\n---\n\nmore');
  });
});
