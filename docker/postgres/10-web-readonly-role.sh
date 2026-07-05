#!/usr/bin/env bash
set -euo pipefail

# Provision a read-only Postgres role for the web dashboard (apps/web). The
# dashboard only SELECTs (listing + analytics); every write goes through the MCP
# server's privileged role. Point the dashboard's WEB_DATABASE_URL at this role
# so a dashboard bug or compromise cannot mutate memories — defense-in-depth
# (#206). If WEB_DATABASE_URL is left unset the dashboard falls back to the full
# DATABASE_URL and this role simply goes unused.
#
# Runs once, when the data volume is first initialised. The password comes from
# the environment so it is never baked into an image; it defaults to a dev value
# for local compose — set WEB_DB_READONLY_PASSWORD to a strong secret in prod.
role="${WEB_DB_READONLY_USER:-engram_readonly}"
password="${WEB_DB_READONLY_PASSWORD:-dev_password_readonly}"

# %I / %L quote the identifier/literal safely; \gexec runs the generated
# statement only when the role is absent, so re-runs are idempotent. The
# quoted heredoc keeps bash out of the SQL (no $$-style surprises); values
# arrive as psql variables instead.
psql -v ON_ERROR_STOP=1 \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  --set=role="${role}" \
  --set=password="${password}" \
  --set=dbname="${POSTGRES_DB}" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'role', :'password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'role')
\gexec
GRANT CONNECT ON DATABASE :"dbname" TO :"role";
GRANT USAGE ON SCHEMA public TO :"role";
GRANT SELECT ON ALL TABLES IN SCHEMA public TO :"role";
-- Cover tables that Prisma migrations create after this script runs.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO :"role";
SQL

echo "Provisioned read-only dashboard role: ${role}"
