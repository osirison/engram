/**
 * Backup / restore integration test.
 *
 * Verifies that:
 *   1. backup.sh produces a valid archive containing a postgres dump.
 *   2. restore.sh --pg-only --no-confirm replays that dump into a fresh schema.
 *   3. The restored data matches what was originally written — including the
 *      WP2-4 tables (memory_links / memory_audits / memory_import_sources), so a
 *      future dump narrowing to a table allowlist that omits them is caught (G9).
 *
 * Requires PGVECTOR_TEST_URL pointing at a real Postgres instance that has the
 * ENGRAM schema migrated (the new-table assertions insert into memories/users/…),
 * with the psql and pg_dump CLI tools available. Skipped automatically when the
 * env var is absent. CI provisions the schema via `db:migrate:deploy` before
 * `pnpm test` (ci.yml), so this runs with the tables already present.
 */

import { execFileSync, execSync } from 'node:child_process';
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
 * Run SQL with no shell involved (execFileSync), so the WP2-4 tables' camelCase
 * columns — which Postgres requires double-quoted, e.g. "targetLocator" — survive
 * without colliding with the shell quoting `psql()` above relies on. ON_ERROR_STOP
 * makes a bad seed fail loudly instead of silently continuing.
 */
function pexec(sql: string): string {
  return execFileSync(
    'psql',
    [TEST_URL!, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql],
    {
      encoding: 'utf8',
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  ).trim();
}

/**
 * Seed one FK-valid graph across the WP2-4 tables with distinctive sentinel
 * values. Idempotent: pre-deletes any leftovers (child→parent) before inserting.
 * memory_links needs a real users+memories parent chain (NOT NULL Cascade FKs);
 * memory_audits/memory_import_sources have no FK (audit rows deliberately survive
 * hard deletes). targetMemoryId is left NULL to also cover the unresolved-link case.
 * updatedAt is set explicitly because Prisma's @updatedAt has no DB default.
 */
const SEED_NEW_TABLES = `
DELETE FROM memory_links WHERE id = 'g9-link';
DELETE FROM memory_audits WHERE id = 'g9-audit';
DELETE FROM memory_import_sources WHERE id = 'g9-import';
DELETE FROM memories WHERE id = 'g9-mem';
DELETE FROM users WHERE id = 'g9-user';
INSERT INTO users (id, email, "createdAt", "updatedAt")
  VALUES ('g9-user', 'g9-backup-sentinel@example.test', now(), now());
INSERT INTO memories (id, "userId", content, tags, type, version, "createdAt", "updatedAt", embedding)
  VALUES ('g9-mem', 'g9-user', 'g9 backup sentinel memory', '{}', 'long-term', 1, now(), now(), '{}');
INSERT INTO memory_links
  (id, "userId", "sourceMemoryId", "targetLocator", "relType", origin, "createdAt", "updatedAt")
  VALUES ('g9-link', 'g9-user', 'g9-mem', 'id:g9-link-sentinel', 'related-to', 'authored', now(), now());
INSERT INTO memory_audits (id, "memoryId", "userId", action, "actorType", delegated, "createdAt")
  VALUES ('g9-audit', 'g9-mem', 'g9-user', 'g9-audit-sentinel', 'system', false, now());
INSERT INTO memory_import_sources
  (id, "userId", "memoryId", "sourceTool", "sourcePath", "sourceKey", "contentHash", "importBatchId", "importedAt", "updatedAt")
  VALUES ('g9-import', 'g9-user', 'g9-mem', 'markdown', '/g9/sentinel.md', 'g9-import-sentinel', 'g9-content-hash', 'g9-batch', now(), now());
`;

/** Delete only the new-table sentinel rows (children only) to prove restore brings them back. */
const DELETE_NEW_SENTINELS = `
DELETE FROM memory_links WHERE id = 'g9-link';
DELETE FROM memory_audits WHERE id = 'g9-audit';
DELETE FROM memory_import_sources WHERE id = 'g9-import';
`;

/** Full teardown of the seeded graph (child→parent so Cascade FKs are respected). */
const CLEANUP_NEW_TABLES = `
DELETE FROM memory_links WHERE id = 'g9-link';
DELETE FROM memory_audits WHERE id = 'g9-audit';
DELETE FROM memory_import_sources WHERE id = 'g9-import';
DELETE FROM memories WHERE id = 'g9-mem';
DELETE FROM users WHERE id = 'g9-user';
`;

/** COUNT of each new-table sentinel by a distinctive VALUE column (proves data, not just a row). */
const COUNT_LINK = `SELECT COUNT(*) FROM memory_links WHERE "targetLocator" = 'id:g9-link-sentinel'`;
const COUNT_AUDIT = `SELECT COUNT(*) FROM memory_audits WHERE action = 'g9-audit-sentinel'`;
const COUNT_IMPORT = `SELECT COUNT(*) FROM memory_import_sources WHERE "sourceKey" = 'g9-import-sentinel'`;

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
    // G9: seed the WP2-4 tables so the dump (and restore) is asserted to cover them.
    pexec(SEED_NEW_TABLES);
  });

  afterAll(() => {
    if (!TEST_URL) return;
    try {
      psql('DROP TABLE IF EXISTS _backup_test');
    } catch {
      // best-effort cleanup
    }
    try {
      pexec(CLEANUP_NEW_TABLES);
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

    // Remove the sentinels (legacy + WP2-4 tables) so we can prove restore
    // brought them back — deleting the memory_links child is FK-safe.
    psql(`DELETE FROM _backup_test WHERE data = 'engram-backup-sentinel'`);
    pexec(DELETE_NEW_SENTINELS);
    expect(
      psql(
        `SELECT COUNT(*) FROM _backup_test WHERE data = 'engram-backup-sentinel'`,
      ).trim(),
    ).toBe('0');
    expect(pexec(COUNT_LINK)).toBe('0');
    expect(pexec(COUNT_AUDIT)).toBe('0');
    expect(pexec(COUNT_IMPORT)).toBe('0');

    execSync(
      `bash "${RESTORE_SCRIPT}" --archive "${archivePath}" --pg-only --no-confirm`,
      { env: pgOnlyEnv(), stdio: 'pipe' },
    );

    const after = psql(
      `SELECT data FROM _backup_test WHERE data = 'engram-backup-sentinel'`,
    );
    expect(after).toContain('engram-backup-sentinel');
    // G9: the WP2-4 tables (typed links / audit trail / import provenance) must
    // survive the full backup→destroy→restore cycle, not just the legacy table.
    expect(pexec(COUNT_LINK)).toBe('1');
    expect(pexec(COUNT_AUDIT)).toBe('1');
    expect(pexec(COUNT_IMPORT)).toBe('1');
  });
});
