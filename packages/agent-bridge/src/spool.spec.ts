import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { SpoolStore } from './spool.js';
import type { SpoolEntry } from './types.js';

function tempSpool(): string {
  return join(mkdtempSync(join(tmpdir(), 'engram-spool-')), 'spool.jsonl');
}

function entry(content: string): SpoolEntry {
  const payload = { userId: 'qp', content, type: 'auto' as const, scope: 'project:engram' };
  return { idempotencyKey: 'k', tool: 'remember', payload, spooledAt: '2026-07-06T00:00:00.000Z' };
}

describe('SpoolStore', () => {
  const paths: string[] = [];
  afterEach(() => {
    for (const p of paths.splice(0)) if (existsSync(p)) writeFileSync(p, '');
  });

  it('returns [] when the spool file does not exist', () => {
    const store = new SpoolStore(tempSpool());
    expect(store.readAll()).toEqual([]);
  });

  it('appends and reads back entries', () => {
    const path = tempSpool();
    paths.push(path);
    const store = new SpoolStore(path);
    store.append(entry('a'));
    store.append(entry('b'));
    const all = store.readAll();
    expect(all).toHaveLength(2);
    expect(all[0]!.payload.content).toBe('a');
    expect(all[1]!.payload.content).toBe('b');
  });

  it('skips corrupt lines rather than losing the whole spool', () => {
    const path = tempSpool();
    paths.push(path);
    const store = new SpoolStore(path);
    store.append(entry('good'));
    writeFileSync(path, readFileSync(path, 'utf8') + '{ this is not json\n');
    store.append(entry('good2'));
    const all = store.readAll();
    expect(all.map((e) => e.payload.content)).toEqual(['good', 'good2']);
  });

  it('replaceAll removes the file when given an empty list', () => {
    const path = tempSpool();
    const store = new SpoolStore(path);
    store.append(entry('a'));
    store.replaceAll([]);
    expect(existsSync(path)).toBe(false);
    expect(store.readAll()).toEqual([]);
  });

  it('makeKey is deterministic for identical payloads and differs on content', () => {
    const store = new SpoolStore(tempSpool());
    const p1 = { userId: 'qp', content: 'x', type: 'auto' as const, scope: 's' };
    const p2 = { userId: 'qp', content: 'x', type: 'auto' as const, scope: 's' };
    const p3 = { userId: 'qp', content: 'y', type: 'auto' as const, scope: 's' };
    expect(store.makeKey(p1)).toBe(store.makeKey(p2));
    expect(store.makeKey(p1)).not.toBe(store.makeKey(p3));
  });

  it('takeSnapshot + commitDrain does not clobber a concurrent append', () => {
    const path = tempSpool();
    paths.push(path);
    const store = new SpoolStore(path);
    store.append(entry('a'));
    store.append(entry('b'));

    const snapshot = store.takeSnapshot(); // moves a,b aside
    expect(snapshot.map((e) => e.payload.content)).toEqual(['a', 'b']);

    // a concurrent append lands during the drain — it must survive
    store.append(entry('c'));
    // 'a' replayed OK; 'b' failed and is re-queued
    store.commitDrain([entry('b')]);

    expect(
      store
        .readAll()
        .map((e) => e.payload.content)
        .sort()
    ).toEqual(['b', 'c']);
  });

  it('takeSnapshot recovers a temp left by a crashed prior drain', () => {
    const path = tempSpool();
    paths.push(path);
    const store = new SpoolStore(path);
    store.append(entry('x'));
    store.takeSnapshot(); // claims x into temp, then "crash" (no commitDrain)

    store.append(entry('y'));
    const snap = store.takeSnapshot(); // recovers x from temp AND claims y
    expect(snap.map((e) => e.payload.content).sort()).toEqual(['x', 'y']);
  });
});
