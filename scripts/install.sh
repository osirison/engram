#!/usr/bin/env bash
# ENGRAM one-command installer.
#
# Sets ENGRAM up end-to-end — dependencies, database, and a build that is ready
# to run — so you can go from a fresh clone to a running memory server in a
# single command. Every step is idempotent, so it is safe to re-run.
#
# Usage:
#   ./scripts/install.sh [--lite | --standard] [--start]
#
# Profiles (details in docs/SETUP.md):
#   --lite       Single-user. No auth/API-key surface. Postgres only. (default)
#   --standard   Multi-tenant: auth, API keys, rate limits. Postgres only.
#
# Flags:
#   --start      Launch the MCP server (foreground) once setup finishes.
#   -h, --help   Show this help and exit.
#
# Requirements:
#   - Node.js 20+ (ships with npm)
#   - Docker + Docker Compose v2 for the bundled Postgres — OR point
#     DATABASE_URL at your own Postgres that has the pgvector extension and
#     skip Docker.

set -euo pipefail

# ── Locate the repo root (this script lives in <root>/scripts) ────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# ── Logging ───────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
else
  BOLD=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi
info() { printf '%s==>%s %s\n' "${GREEN}${BOLD}" "$RESET" "$*"; }
warn() { printf '%swarning:%s %s\n' "${YELLOW}${BOLD}" "$RESET" "$*" >&2; }
die()  { printf '%serror:%s %s\n' "${RED}${BOLD}" "$RESET" "$*" >&2; exit 1; }
step() { printf '\n%s%s%s\n' "$BOLD" "$*" "$RESET"; }

usage() {
  cat <<'EOF'
ENGRAM installer — from a fresh clone to a running memory server.

Usage:
  ./scripts/install.sh [--lite | --standard] [--start]

Profiles:
  --lite       Single-user, no auth. Postgres only. (default)
  --standard   Multi-tenant: auth, API keys, rate limits. Postgres only.

Flags:
  --start      Launch the MCP server once setup finishes.
  -h, --help   Show this help and exit.
EOF
}

# ── Parse arguments ───────────────────────────────────────────────────────────
PROFILE="lite"
START=0
while [ $# -gt 0 ]; do
  case "$1" in
    --lite)     PROFILE="lite" ;;
    --standard) PROFILE="standard" ;;
    --start)    START=1 ;;
    -h|--help)  usage; exit 0 ;;
    *)          usage >&2; die "unknown option: $1" ;;
  esac
  shift
done

step "ENGRAM installer — profile: ${PROFILE}"

# ── Preflight: Node.js 20+ ────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 \
  || die "Node.js 20+ is required but 'node' was not found. Install it from https://nodejs.org."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  die "Node.js 20+ is required (found $(node -v)). Upgrade from https://nodejs.org."
fi
info "Node $(node -v) detected."

# ── Pick a package manager: global pnpm, else the pinned pnpm via npm ─────────
if command -v pnpm >/dev/null 2>&1; then
  PM=(pnpm)
else
  command -v npm >/dev/null 2>&1 \
    || die "Neither 'pnpm' nor 'npm' was found. Install Node.js 20+ (which bundles npm)."
  info "pnpm not on PATH — using the pinned pnpm@11.5.0 through npm."
  PM=(npm exec --yes pnpm@11.5.0 --)
fi

# ── Detect Docker (for the bundled Postgres) ──────────────────────────────────
DOCKER_OK=0
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    DOCKER_OK=1
  else
    warn "Docker is installed but its daemon is not reachable. Start Docker, or point DATABASE_URL at your own Postgres."
  fi
else
  warn "Docker with Compose v2 was not found. The bundled Postgres will not start — point DATABASE_URL at your own Postgres (with the pgvector extension)."
fi

# ── 1. Environment file ───────────────────────────────────────────────────────
step "1/5  Environment"
if [ -f .env ]; then
  info ".env already exists — leaving it untouched."
else
  cp .env.example .env
  info "Created .env from .env.example."
fi

# ── 2. Dependencies ───────────────────────────────────────────────────────────
step "2/5  Install dependencies"
"${PM[@]}" install

# ── 3. Database ───────────────────────────────────────────────────────────────
step "3/5  Database"
if [ "$DOCKER_OK" -eq 1 ]; then
  info "Starting PostgreSQL (pgvector) via Docker…"
  "${PM[@]}" docker:up
else
  warn "Skipping 'docker:up'. The next step needs a reachable Postgres at DATABASE_URL."
fi
info "Generating the Prisma client…"
"${PM[@]}" db:generate
info "Applying migrations…"
"${PM[@]}" db:migrate:deploy

# ── 4. Build ──────────────────────────────────────────────────────────────────
step "4/5  Build"
if [ "$PROFILE" = "lite" ]; then
  DEPLOYMENT_PROFILE=lite "${PM[@]}" build
else
  "${PM[@]}" build
fi

# ── 5. Embeddings (optional, non-fatal) ───────────────────────────────────────
step "5/5  Embeddings (optional)"
OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
if ! command -v curl >/dev/null 2>&1; then
  info "Skipping the embeddings check ('curl' not found). Semantic recall uses a local Ollama server by default."
elif curl -fsS --max-time 2 "${OLLAMA_URL}/api/tags" >/dev/null 2>&1; then
  info "Ollama reachable at ${OLLAMA_URL} — semantic recall is available (pull the model with: ollama pull nomic-embed-text)."
else
  warn "No Ollama server at ${OLLAMA_URL}. Memories still store and recall lexically; for semantic recall install Ollama (https://ollama.com/download) then 'ollama pull nomic-embed-text', or run 'docker compose --profile ollama up -d'."
fi

# ── Done ──────────────────────────────────────────────────────────────────────
if [ "$PROFILE" = "lite" ]; then
  START_CMD="DEPLOYMENT_PROFILE=lite ${PM[*]} --filter mcp-server dev"
else
  START_CMD="${PM[*]} --filter mcp-server dev"
fi

step "✓ ENGRAM is ready (profile: ${PROFILE})."

if [ "$START" -eq 1 ]; then
  info "Starting the MCP server on http://localhost:3000 — press Ctrl-C to stop."
  if [ "$PROFILE" = "lite" ]; then
    exec env DEPLOYMENT_PROFILE=lite "${PM[@]}" --filter mcp-server dev
  else
    exec "${PM[@]}" --filter mcp-server dev
  fi
fi

cat <<EOF

Next steps:
  1. Start the server:
       ${START_CMD}
  2. Check it is up (in a second terminal):
       curl http://localhost:3000/health
  3. Connect Claude Desktop / Claude Code — see the MCP client setup in docs/SETUP.md.

Re-run this installer any time (safe & idempotent), or pass --start to launch the
server automatically. Full developer guide: docs/SETUP.md
EOF
