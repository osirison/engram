/**
 * Backup / restore integration test.
 *
 * Verifies that:
 *   1. backup.sh produces a valid archive containing a postgres dump.
 *   2. restore.sh --pg-only --no-confirm replays that dump into a fresh schema.
 *   3. The restored data matches what was originally written.
 *
 * Requires PGVECTOR_TEST_URL pointing at a real Postgres instance with
 * the psql and pg_dump CLI tools available.  Skipped automatically when
 * the env var is absent.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_URL = process.env.PGVECTOR_TEST_URL;

const itIfPg = TEST_URL ? it : it.skip;

const REPO_ROOT = join(__dirname, '../../../..');
const BACKUP_SCRIPT = join(REPO_ROOT, 'scripts/backup.sh');
const RESTORE_SCRIPT = join(REPO_ROOT, 'scripts/restore.sh');

function psql(query: string): string {
  return execSync(`psql "${TEST_URL!}" -t -c "${query}"`, {
    encoding: 'utf8',
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Environment for the backup/restore scripts scoped to Postgres only.
 * REDIS_URL and QDRANT_URL are stripped so the scripts skip those stores —
 * the CI runner has no redis-cli, and this suite only asserts on the postgres
 * dump, so it must not depend on redis/qdrant being reachable.
 */
function pgOnlyEnv(): NodeJS.ProcessEnv {
  // Annotate as ProcessEnv so the index signature survives (object spread
  // drops it), keeping REDIS_URL / QDRANT_URL deletable under strict tsc.
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: TEST_URL };
  delete env.REDIS_URL;
  delete env.QDRANT_URL;
  return env;
}

describe('backup / restore (postgres)', () => {
  let backupDir: string;

  beforeAll(() => {
    if (!TEST_URL) return;
    psql(
      `CREATE TABLE IF NOT EXISTS _backup_test (id serial PRIMARY KEY, data text NOT NULL)`,
    );
    psql(`INSERT INTO _backup_test (data) VALUES ('engram-backup-sentinel')`);
  });

  afterAll(() => {
    if (!TEST_URL) return;
    try {
      psql('DROP TABLE IF EXISTS _backup_test');
    } catch {
      // best-effort cleanup
    }
    // Remove the temp backup directory (and its archives) so repeated CI runs
    // do not accumulate gigabyte-scale leftovers in the OS temp dir.
    if (backupDir) {
      rmSync(backupDir, { recursive: true, force: true });
    }
  });

  itIfPg('backup.sh produces an archive with a postgres dump', () => {
    backupDir = mkdtempSync(join(tmpdir(), 'engram-backup-test-'));

    execSync(`bash "${BACKUP_SCRIPT}" --out "${backupDir}"`, {
      env: pgOnlyEnv(),
      stdio: 'pipe',
    });

    const archives = readdirSync(backupDir).filter((f) =>
      f.endsWith('.tar.gz'),
    );
    expect(archives.length).toBeGreaterThan(0);

    const archivePath = join(backupDir, archives[0]!);
    expect(existsSync(archivePath)).toBe(true);

    const listing = execSync(`tar -tzf "${archivePath}"`, { encoding: 'utf8' });
    expect(listing).toContain('postgres.pgdump');
  });

  itIfPg('restore.sh --pg-only replays the dump and data survives', () => {
    const archives = readdirSync(backupDir).filter((f) =>
      f.endsWith('.tar.gz'),
    );
    // Guard against the first test having failed to produce an archive so the
    // failure points here rather than at a nonsensical '.../undefined' path.
    expect(archives.length).toBeGreaterThan(0);
    const archivePath = join(backupDir, archives[0]!);

    // Remove the sentinel so we can prove restore brought it back.
    psql(`DELETE FROM _backup_test WHERE data = 'engram-backup-sentinel'`);
    const before = psql(
      `SELECT COUNT(*) FROM _backup_test WHERE data = 'engram-backup-sentinel'`,
    );
    expect(before.trim()).toBe('0');

    execSync(
      `bash "${RESTORE_SCRIPT}" --archive "${archivePath}" --pg-only --no-confirm`,
      { env: pgOnlyEnv(), stdio: 'pipe' },
    );

    const after = psql(
      `SELECT data FROM _backup_test WHERE data = 'engram-backup-sentinel'`,
    );
    expect(after).toContain('engram-backup-sentinel');
  });
});
