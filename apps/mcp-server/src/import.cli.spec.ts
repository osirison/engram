import { parseArgs } from './import.cli';

describe('import.cli parseArgs', () => {
  it('parses positional <source> <path> plus common flags', () => {
    const args = parseArgs([
      'claude-code',
      '/vault',
      '--user',
      'qp',
      '--scope',
      'project:engram',
      '--dry-run',
      '--secrets',
      'flag',
      '--no-embed',
      '--split-headings',
      '--include-global',
    ]);
    expect(args).toEqual({
      source: 'claude-code',
      path: '/vault',
      userId: 'qp',
      scope: 'project:engram',
      dryRun: true,
      secretsPolicy: 'flag',
      embed: false,
      splitHeadings: true,
      includeGlobal: true,
    });
  });

  it('accepts every valid source', () => {
    for (const source of [
      'claude-code',
      'copilot',
      'cursor',
      'codex',
      'gemini',
      'markdown',
    ]) {
      expect(parseArgs([source, '/p', '--user', 'qp']).source).toBe(source);
    }
  });

  it('ignores an unknown source (leaves it undefined for the usage guard)', () => {
    expect(parseArgs(['bogus', '/p', '--user', 'qp']).source).toBeUndefined();
  });

  it('ignores an invalid --secrets value', () => {
    expect(
      parseArgs(['markdown', '/p', '--user', 'qp', '--secrets', 'nope'])
        .secretsPolicy,
    ).toBeUndefined();
  });

  it('defaults embed/dryRun to undefined when their flags are absent', () => {
    const args = parseArgs(['markdown', '/p', '--user', 'qp']);
    expect(args.embed).toBeUndefined();
    expect(args.dryRun).toBeUndefined();
    expect(args.secretsPolicy).toBeUndefined();
  });
});
