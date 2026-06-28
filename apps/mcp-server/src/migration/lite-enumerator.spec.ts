import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { enumerateLiteUsers, countLiteMemories } from './lite-enumerator';

const workDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'engram-lite-enum-'));
  workDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (workDirs.length > 0) {
    const dir = workDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('enumerateLiteUsers', () => {
  it('returns [] when the memories directory does not exist (ENOENT)', async () => {
    const result = await enumerateLiteUsers(
      '/tmp/engram-enum-does-not-exist-abc987xyz',
    );
    expect(result).toEqual([]);
  });

  it('re-throws errors that are not ENOENT', async () => {
    const dataDir = makeTempDir();
    // Place a regular file where the 'memories' directory should be → readdir throws ENOTDIR
    writeFileSync(path.join(dataDir, 'memories'), 'not-a-directory');
    await expect(enumerateLiteUsers(dataDir)).rejects.toThrow();
  });

  it('decodes valid percent-encoded userId entries', async () => {
    const dataDir = makeTempDir();
    mkdirSync(path.join(dataDir, 'memories', 'alice%40example.com'), {
      recursive: true,
    });
    const result = await enumerateLiteUsers(dataDir);
    expect(result).toEqual(['alice@example.com']);
  });

  it('returns the raw entry when decoding fails (malformed percent encoding)', async () => {
    const dataDir = makeTempDir();
    // %gg is invalid: 'g' is not a hex digit, so decodeURIComponent throws URIError
    mkdirSync(path.join(dataDir, 'memories', '%gg'), { recursive: true });
    const result = await enumerateLiteUsers(dataDir);
    expect(result).toEqual(['%gg']);
  });
});

describe('countLiteMemories', () => {
  it('counts memories across multiple pages', async () => {
    const store = {
      list: jest
        .fn()
        .mockResolvedValueOnce({ items: ['a', 'b', 'c'], nextCursor: 'c1' })
        .mockResolvedValueOnce({ items: ['d', 'e'], nextCursor: null }),
    };
    const count = await countLiteMemories(store as never, 'user1');
    expect(count).toBe(5);
  });

  it('throws after 500 pages when the cursor never exhausts', async () => {
    const store = {
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: 'infinite' }),
    };
    await expect(countLiteMemories(store as never, 'user1')).rejects.toThrow(
      /cursor loop exceeded 500 pages/,
    );
    expect(store.list).toHaveBeenCalledTimes(500);
  });
});
