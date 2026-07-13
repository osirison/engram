import { describe, it, expect } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { namespaceSourceKey, rootFingerprint, ROOT_FINGERPRINT_LENGTH } from './source-key.js';

describe('rootFingerprint', () => {
  it('is a stable 12-hex discriminator of the root path', () => {
    const fp = rootFingerprint('/repo-a');
    expect(fp).toMatch(new RegExp(`^[0-9a-f]{${ROOT_FINGERPRINT_LENGTH}}$`));
    expect(rootFingerprint('/repo-a')).toBe(fp); // deterministic
    expect(rootFingerprint('/repo-b')).not.toBe(fp); // discriminates roots
  });

  it('normalizes relative spellings of a non-existent root via resolve()', () => {
    expect(rootFingerprint('/x/../repo-a')).toBe(rootFingerprint('/repo-a'));
  });

  it('dereferences symlinks so two spellings of one real dir agree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'engram-source-key-'));
    const link = `${dir}-link`;
    symlinkSync(dir, link);
    try {
      expect(rootFingerprint(link)).toBe(rootFingerprint(realpathSync(dir)));
    } finally {
      rmSync(link);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('namespaceSourceKey', () => {
  it('inserts the fingerprint between tool and relpath', () => {
    const fp = rootFingerprint('/repo-a');
    expect(namespaceSourceKey('claude-code:CLAUDE.md', '/repo-a')).toBe(
      `claude-code@${fp}:CLAUDE.md`
    );
  });

  it('keeps the #anchor suffix parseable (anchor stays after the last #)', () => {
    const key = namespaceSourceKey('codex:AGENTS.md#conventions', '/repo-a');
    expect(key.endsWith('#conventions')).toBe(true);
    expect(key.slice(key.indexOf('#') + 1)).toBe('conventions');
  });

  it('two roots sharing a relpath produce distinct keys', () => {
    const a = namespaceSourceKey('claude-code:CLAUDE.md', '/repo-a');
    const b = namespaceSourceKey('claude-code:CLAUDE.md', '/repo-b');
    expect(a).not.toBe(b);
  });
});
