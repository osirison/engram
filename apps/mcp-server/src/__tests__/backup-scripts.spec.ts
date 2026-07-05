/**
 * Unit-level tests for the ops shell scripts (scripts/*.sh).
 *
 * These run everywhere — no Postgres/Redis/Qdrant/docker required:
 *   - syntax checks (`bash -n`) for all three scripts,
 *   - argument validation for backup.sh / restore.sh,
 *   - full behavioral coverage of retention.sh's GFS pruning against
 *     fake aged archives in a temp directory.
 *
 * The service-level round-trip of backup.sh/restore.sh lives in
 * backup-restore.spec.ts (Postgres leg, gated on PGVECTOR_TEST_URL) and in
 * .github/workflows/backup-verify.yml (nightly, all three stores).
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '../../../..');
const SCRIPTS = {
  backup: join(REPO_ROOT, 'scripts/backup.sh'),
  restore: join(REPO_ROOT, 'scripts/restore.sh'),
  retention: join(REPO_ROOT, 'scripts/retention.sh'),
} as const;

/** Format a date as the YYYYMMDD used in archive filenames (local time,
 *  matching the `date +%Y%m%d` the scripts themselves use). */
function yyyymmdd(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function archiveName(daysAgo: number, time = '010101'): string {
  return `engram_backup_${yyyymmdd(daysAgo)}_${time}.tar.gz`;
}

function runRetention(dir: string, days: number, weeks: number): string {
  return execSync(
    `bash "${SCRIPTS.retention}" --dir "${dir}" --days ${days} --weeks ${weeks}`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
}

describe('ops scripts — syntax', () => {
  it.each(Object.entries(SCRIPTS))(
    '%s script parses under bash -n',
    (_name, path) => {
      expect(() =>
        execSync(`bash -n "${path}"`, { stdio: 'pipe' }),
      ).not.toThrow();
    },
  );
});

describe('restore.sh — argument validation', () => {
  it('fails without --archive', () => {
    expect.assertions(2);
    try {
      execSync(`bash "${SCRIPTS.restore}"`, { stdio: 'pipe' });
    } catch (error) {
      const err = error as { status: number; stderr: Buffer };
      expect(err.status).toBe(1);
      expect(err.stderr.toString()).toContain('--archive is required');
    }
  });

  it('fails when the archive file does not exist', () => {
    expect.assertions(2);
    try {
      execSync(
        `bash "${SCRIPTS.restore}" --archive /nonexistent/nope.tar.gz --no-confirm`,
        { stdio: 'pipe' },
      );
    } catch (error) {
      const err = error as { status: number; stderr: Buffer };
      expect(err.status).toBe(1);
      expect(err.stderr.toString()).toContain('archive not found');
    }
  });

  it('rejects unknown arguments', () => {
    expect(() =>
      execSync(`bash "${SCRIPTS.restore}" --bogus`, { stdio: 'pipe' }),
    ).toThrow();
  });
});

describe('backup.sh — argument validation', () => {
  it('rejects unknown arguments', () => {
    expect(() =>
      execSync(`bash "${SCRIPTS.backup}" --bogus`, { stdio: 'pipe' }),
    ).toThrow();
  });
});

describe('retention.sh — GFS pruning', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'engram-retention-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function touch(name: string): string {
    const p = join(dir, name);
    writeFileSync(p, 'fake-archive');
    return p;
  }

  it('keeps archives inside the daily window', () => {
    const recent = touch(archiveName(2));
    const output = runRetention(dir, 30, 12);

    expect(existsSync(recent)).toBe(true);
    expect(output).toContain('keep (daily)');
  });

  it('keeps exactly one archive per ISO week inside the weekly window', () => {
    // Two archives on the same day (same ISO week), older than the 30-day
    // daily window but inside the 12-week weekly window. The older one sorts
    // first and claims the week's keep slot.
    const weekA = touch(archiveName(45, '010101'));
    const weekB = touch(archiveName(45, '020202'));
    const output = runRetention(dir, 30, 12);

    expect(existsSync(weekA)).toBe(true);
    expect(existsSync(weekB)).toBe(false);
    expect(output).toContain('keep (weekly)');
  });

  it('deletes archives beyond the weekly window', () => {
    const ancient = touch(archiveName(120));
    const output = runRetention(dir, 30, 12);

    expect(existsSync(ancient)).toBe(false);
    expect(output).toContain('delete (old)');
  });

  it('applies the full policy across mixed ages in one run', () => {
    const recent = touch(archiveName(2));
    const weekA = touch(archiveName(45, '010101'));
    const weekB = touch(archiveName(45, '020202'));
    const ancient = touch(archiveName(120));

    runRetention(dir, 30, 12);

    expect(existsSync(recent)).toBe(true);
    expect(existsSync(weekA)).toBe(true);
    expect(existsSync(weekB)).toBe(false);
    expect(existsSync(ancient)).toBe(false);
  });

  it('goes straight to weekly rotation when --days 0', () => {
    // Documented in the runbook: BACKUP_RETENTION_DAYS=0 skips the daily
    // window. Two same-week archives collapse to one even when recent.
    const first = touch(archiveName(2, '010101'));
    const second = touch(archiveName(2, '020202'));

    runRetention(dir, 0, 12);

    const survivors = [first, second].filter((p) => existsSync(p));
    expect(survivors).toHaveLength(1);
  });

  it('ignores files that do not match the archive naming scheme', () => {
    const unrelated = touch('unrelated.tar.gz');
    const badDate = touch('engram_backup_notadate.tar.gz');
    const ancient = touch(archiveName(120));

    runRetention(dir, 30, 12);

    expect(existsSync(unrelated)).toBe(true);
    expect(existsSync(badDate)).toBe(true);
    expect(existsSync(ancient)).toBe(false);
  });
});
