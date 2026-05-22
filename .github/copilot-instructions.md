---
title: ENGRAM Copilot Instructions
description: Project rules for GitHub Copilot in the ENGRAM repository
---

## Start Here

Follow [AGENTS.md](../AGENTS.md) for the full project rules. Keep responses and
changes focused on the user's request.

## Project Basics

- ENGRAM is a TypeScript, NestJS, Prisma, Redis, Qdrant, and Turborepo monorepo.
- The main runtime is [apps/mcp-server](../apps/mcp-server).
- Local setup starts from [README.md](../README.md) and [docs/SETUP.md](../docs/SETUP.md).
- Use existing workspace packages before adding new dependencies or abstractions.

## Development Rules

- Do not work directly on `main`; use a feature branch.
- Use NestJS and Prisma CLIs for generated framework files and migrations.
- Keep TypeScript strict and avoid `any`.
- Add or update tests when behavior changes.
- Keep documentation short, current, and linked from the root README.
- Never commit secrets, local `.env` files, or generated credentials.

## Common Commands

```bash
pnpm install
cp .env.example .env
pnpm docker:up
pnpm db:generate
pnpm db:migrate
pnpm --filter mcp-server dev
```

Run quality checks from the repository root:

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm docs:check
```
