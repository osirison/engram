import { decodeWatchKey, encodeWatchKey, parseWatchArgs } from './watch.cli';

describe('watch.cli parseWatchArgs', () => {
  it('parses roots plus flags', () => {
    const args = parseWatchArgs([
      '/repo',
      '/home/qp/.claude',
      '--user',
      'qp',
      '--scope',
      'project:engram',
      '--debounce',
      '2000',
      '--force',
      '--no-embed',
      '--once',
    ]);
    expect(args).toEqual({
      roots: ['/repo', '/home/qp/.claude'],
      userId: 'qp',
      scope: 'project:engram',
      debounceMs: 2000,
      force: true,
      embed: false,
      once: true,
    });
  });

  it('defaults to an empty roots list when none are given', () => {
    expect(parseWatchArgs(['--user', 'qp']).roots).toEqual([]);
  });

  it('ignores a non-numeric debounce value', () => {
    expect(parseWatchArgs(['--debounce', 'abc']).debounceMs).toBeUndefined();
  });
});

describe('watch key encoding', () => {
  it('round-trips a normal root', () => {
    expect(decodeWatchKey(encodeWatchKey('/repo', 'codex'))).toEqual({
      root: '/repo',
      source: 'codex',
    });
  });

  it('round-trips a root that contains spaces (regression)', () => {
    const root = '/home/qp/My Projects/engram';
    expect(decodeWatchKey(encodeWatchKey(root, 'claude-code'))).toEqual({
      root,
      source: 'claude-code',
    });
  });
});
