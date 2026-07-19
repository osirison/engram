# syntax=docker/dockerfile:1

# ── Stage 1: dependency resolution ───────────────────────────────────────────
FROM node:22-alpine AS deps
RUN npm install -g pnpm@11.5.0 --no-update-notifier

WORKDIR /build

# Copy ALL workspace manifests so pnpm --frozen-lockfile sees a complete workspace.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/mcp-server/package.json apps/mcp-server/
COPY apps/docs/package.json apps/docs/
COPY apps/web/package.json apps/web/
COPY apps/vscode-copilot-compressor/package.json apps/vscode-copilot-compressor/
COPY packages/client/package.json packages/client/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/database/package.json packages/database/
COPY packages/embeddings/package.json packages/embeddings/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/eval/package.json packages/eval/
COPY packages/memory-lite/package.json packages/memory-lite/
COPY packages/memory-ltm/package.json packages/memory-ltm/
COPY packages/memory-stm/package.json packages/memory-stm/
COPY packages/typescript-config/package.json packages/typescript-config/
COPY packages/ui/package.json packages/ui/
COPY packages/vector-store/package.json packages/vector-store/

RUN pnpm install --frozen-lockfile --ignore-scripts

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM deps AS builder
WORKDIR /build

COPY . .

# Generate Prisma client before compiling TypeScript.
RUN pnpm db:generate

# Build all workspace packages then deploy only mcp-server production deps.
RUN pnpm build
RUN pnpm --filter mcp-server deploy --prod --legacy /prod
# Regenerate Prisma client inside the deployed directory.
# pnpm deploy creates a clean node_modules; the generated .prisma/client
# artefacts are absent so we re-run generate using the build stage's prisma CLI.
COPY prisma /prod/prisma
RUN cd /prod && /build/node_modules/.bin/prisma generate

# ── Stage 3: production image ─────────────────────────────────────────────────
FROM node:22-alpine AS production

LABEL org.opencontainers.image.title="engram-mcp-server" \
      org.opencontainers.image.description="ENGRAM MCP memory server" \
      org.opencontainers.image.source="https://github.com/osirison/engram"

# Non-root user for least-privilege runtime.
RUN addgroup -S engram && adduser -S -G engram engram

# Drop the npm CLI from the runtime image. The app runs plain `node
# dist/main.js` (npm/npx are never invoked at runtime), and npm's vendored
# node_modules ship fixable HIGH CVEs (picomatch CVE-2026-33671, sigstore
# CVE-2026-48815) that would trip the blocking trivy CI gate (#208). Removing
# the CLI also shrinks the image and its attack surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

WORKDIR /app

# Copy the pruned production artefact from builder.
COPY --from=builder --chown=engram:engram /prod /app

# Prisma requires the query engine binary (copied by `pnpm deploy`).
# The schema is needed at runtime only when the app invokes `prisma migrate`.
COPY --from=builder --chown=engram:engram /build/prisma /app/prisma

USER engram

ENV NODE_ENV=production \
    PORT=3000 \
    DEPLOYMENT_PROFILE=enterprise \
    MCP_TRANSPORT=streamable-http

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]
