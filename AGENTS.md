---
title: ENGRAM Agent Instructions
description: Simple project rules for agents and contributors working in ENGRAM
---

## Token Efficiency

IMPORTANT: Always prioritize token efficiency in your responses and explanations.

- Always use the `caveman` skill for shorter responses, lower token usage, and condensed explanations.
- Trigger phrases include: "caveman mode", "talk like caveman", "less tokens", "be brief", "save tokens", and "condense".
- Keep technical accuracy intact while reducing verbosity.

## Project Summary

ENGRAM is a TypeScript monorepo for an MCP memory server. The main app is a
NestJS server backed by PostgreSQL, Redis, Qdrant, Prisma, and Turborepo.

Start with [README.md](README.md) for setup commands.

## First Rules

1. Work from a feature branch, never directly on `main`.
2. Keep changes small and tied to the issue or request in front of you.
3. Prefer existing packages, modules, and patterns over new abstractions.
4. Use strict TypeScript. Do not add `any` unless there is no safer option.
5. Add or update tests when behavior changes.
6. Do not commit generated secrets, local `.env` files, or credentials.

## Project Layout

| Path                                           | Purpose                               |
| ---------------------------------------------- | ------------------------------------- |
| [apps/mcp-server](apps/mcp-server)             | Main NestJS MCP server                |
| [apps/web](apps/web)                           | Web app workspace                     |
| [apps/docs](apps/docs)                         | Docs app workspace                    |
| [packages/core](packages/core)                 | MCP types, registry, and tools        |
| [packages/database](packages/database)         | Prisma database module                |
| [packages/redis](packages/redis)               | Redis client module                   |
| [packages/vector-store](packages/vector-store) | Qdrant vector store module            |
| [packages/embeddings](packages/embeddings)     | Embedding providers and cache support |
| [prisma](prisma)                               | Prisma schema and migrations          |

## Use Framework CLIs

Use project and framework commands when they exist.

| Task                       | Command                    |
| -------------------------- | -------------------------- |
| Generate NestJS resource   | `nest g resource <name>`   |
| Generate NestJS module     | `nest g module <name>`     |
| Generate NestJS service    | `nest g service <name>`    |
| Generate NestJS controller | `nest g controller <name>` |
| Generate Prisma client     | `pnpm db:generate`         |
| Create Prisma migration    | `pnpm db:migrate`          |
| Push local Prisma schema   | `pnpm db:push`             |
| Open Prisma Studio         | `pnpm db:studio`           |

Manual file creation is fine for documentation, Zod schemas, custom types,
small utilities, and configuration files when no generator exists.

## Local Development

Use root commands unless a package README says otherwise.

```bash
npm exec --yes pnpm@11.4.0 -- install
test -f .env || cp .env.example .env
npm exec --yes pnpm@11.4.0 -- docker:up
npm exec --yes pnpm@11.4.0 -- db:generate
npm exec --yes pnpm@11.4.0 -- db:migrate
npm exec --yes pnpm@11.4.0 -- build
npm exec --yes pnpm@11.4.0 -- --filter mcp-server dev
```

Quality checks:

```bash
npm exec --yes pnpm@11.4.0 -- build
npm exec --yes pnpm@11.4.0 -- lint
npm exec --yes pnpm@11.4.0 -- typecheck
npm exec --yes pnpm@11.4.0 -- test
npm exec --yes pnpm@11.4.0 -- docs:check
```

## Coding Standards

- Use NestJS modules, services, controllers, providers, and dependency injection.
- Use Prisma for database access.
- Use Zod or NestJS DTO validation for inputs.
- Use Redis, Qdrant, BullMQ, and OpenAI through existing packages.
- Keep logs structured and avoid logging secrets.
- Keep package boundaries clear. Shared behavior belongs in `packages/*`.

## Git Workflow

1. Check the branch with `git status --short --branch`.
2. If on `main`, create a feature branch from the current base.
3. Use conventional commits when committing: `type(scope): summary (#issue)`.
4. Open pull requests against `main`.
5. Link the issue in the PR body with `Closes #issue` when an issue exists.

Useful branch examples:

```text
docs/simplify-onboarding-docs
feat/mcp-tools-#24
fix/health-qdrant-timeout-#19
```

## Documentation Rules

- Keep setup instructions short and copy-pasteable.
- Put detailed explanations in focused docs and link to them from the root README.
- Update [README.md](README.md) when startup commands or project entry points change.
- Update [docs/SETUP.md](docs/SETUP.md) when local setup or MCP client setup changes.
