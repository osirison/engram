# ENGRAM - AI Agent Instructions

ENGRAM = Extended Neural Graph for Recall and Memory. Modular MCP server for AI agent memory management.

## CRITICAL: Use Framework CLIs

**Always use CLI tools. Never manually create framework files.**

### NestJS CLI

```bash
nest g resource <name>     # Full resource (preferred)
nest g module <name>
nest g service <name>
nest g controller <name>
nest g guard <name>
nest g interceptor <name>
nest g filter <name>
nest g pipe <name>
nest g decorator <name>
```

### Prisma CLI

```bash
pnpm db:generate           # Generate client
pnpm db:migrate dev --name <name>  # Create migration
pnpm db:push               # Dev: push without migration
pnpm db:seed               # Seed database
npx prisma studio          # Database GUI
```

### Package/Testing

```bash
pnpm create-package packages/<name>  # New package
npx tsc --init             # TypeScript config
# Copy vitest.config.ts from existing package
```

### Manual Creation Only For

- Zod schemas
- Custom types
- Config files (if no CLI)
- Documentation

## Stack

TypeScript + Node.js 20+ | NestJS | PostgreSQL (Prisma) | Qdrant | Redis | Turborepo | BullMQ | Docker

## Principles

1. Use existing frameworks, never custom solutions
2. Type safety: strict TypeScript, no `any`
3. Modular packages, independent
4. Test-driven: write tests with features
5. Issue-driven: all work requires GitHub issue #

## Structure

```text
apps/mcp-server     → Main MCP server
apps/api            → Future tRPC API
packages/core       → MCP implementation
packages/auth       → OAuth module
packages/memory-*   → Memory modules
packages/analytics  → Analytics
shared/types        → Shared types
```

## Workflow

### 🚨 NEVER WORK ON MAIN BRANCH

All changes in feature branches. Never commit directly to main.

### Before Starting

1. Verify NOT on main: `git branch`
2. Pull latest: `git checkout main && git pull origin main`
3. Verify track label (track:mcp|db|devex|health)
4. Navigate to track worktree: `C:\projects\worktree\engram\{track}`
5. Create branch: `git checkout -b type/description-#issue origin/main`
6. Verify issue exists and links to epic
7. Check dependencies in package.json

### During Development

- Commits: `type(scope): description (#issue)`
- Use existing libs: Zod, Prisma, BullMQ, NestJS, Vitest
- NestJS: Services (logic), Controllers (routes), Modules (organization)
- No `any` types
- Write tests alongside code

## Common Commands

```bash
# Packages
pnpm create-package packages/<name>
pnpm add library-name           # In package dir
pnpm add -w library-name        # Root

# Database
pnpm db:generate                # After schema changes
pnpm db:migrate dev --name <n>  # Migration
pnpm db:push                    # Dev only

# Testing
pnpm test                       # All
pnpm test:watch                 # Watch
pnpm test packages/core         # Specific
```

## GitHub Workflow

Issues provide complete context (scope, criteria, patterns). Templates: Feature Request, Bug Report, Epic.

1. Read issue completely
2. Implement per specifications
3. Verify acceptance criteria
4. Create PR: "Closes #issue"

### Issue Workflow

```bash
# Before: Verify NOT on main, pull latest, check track label, create branch
# During: Commit with issue #, post updates, verify branch
# After: Verify criteria, push branch, create PR, wait for CI, request review
# Format: type(scope): description (#issue)
```

**Commit types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

## Libraries

- **NestJS:** `@nestjs/common`, `@nestjs/config`, `@nestjs/bull`
- **Database:** Prisma, Qdrant, Redis (ioredis)
- **Validation:** Zod, class-validator
- **Testing:** Vitest, `@nestjs/testing`
- **MCP:** `@modelcontextprotocol/sdk`

## Git Worktrees (Standard Process on Windows)

Use Git worktrees to create isolated working directories per issue without constantly switching branches in your main repo. This keeps context clean and enables parallel development.

### Conventions

- Worktree root: `C:\projects\worktree\engram\{name}-{issue}`
- Branch name: `type/kebab-name-#<issue>` (examples below)
- Base ref: `origin/main`

### Preflight

```powershell
git -C "C:\projects\engram" fetch origin --prune
git -C "C:\projects\engram" worktree prune
New-Item -ItemType Directory -Force -Path "C:\projects\worktree\engram" | Out-Null
```

### Create Worktree (General)

```powershell
$issue = 123
$name = "short-kebab-name"
$branch = "feat/$name-#$issue"
$path = "C:\projects\worktree\engram\$name-$issue"

git -C "C:\projects\engram" worktree add -b $branch $path origin/main
```

### Examples

- Issue #23 (MCP SDK handler):

```powershell
$issue = 23
$name = "mcp-sdk-handler"
$branch = "feat/$name-#$issue"   # feat/mcp-sdk-handler-#23
$path = "C:\projects\worktree\engram\$name-$issue"  # C:\projects\worktree\engram\mcp-sdk-handler-23
git -C "C:\projects\engram" worktree add -b $branch $path origin/main
```

- Issue #24 (MCP tools):

```powershell
$issue = 24
$name = "mcp-tools"
$branch = "feat/$name-#$issue"   # feat/mcp-tools-#24
$path = "C:\projects\worktree\engram\$name-$issue"  # C:\projects\worktree\engram\mcp-tools-24
git -C "C:\projects\engram" worktree add -b $branch $path origin/main
```

### Develop, Commit, and Push

```powershell
# Inside the worktree directory
Set-Location $path
git status

# Commit using single-line conventional commits with issue number
git add .
git commit -m "feat(scope): implement X (#$issue)"
git push -u origin $branch
```

### Open PR

Create a PR from `$branch` to `main` with description:

```text
Closes #<issue>
```

### List Worktrees

```powershell
git -C "C:\projects\engram" worktree list
```

### Cleanup After Merge

After your PR is merged:

```powershell
# Remove the worktree folder
Remove-Item -Recurse -Force "C:\projects\worktree\engram\$name-$issue"

# Prune and delete branch
git -C "C:\projects\engram" worktree prune
git -C "C:\projects\engram" branch -D $branch
git -C "C:\projects\engram" push origin --delete $branch
```

Notes:

- Always start worktrees from `origin/main` to ensure latest base.
- Keep branch names short and descriptive.
- Ensure commits are single-line and include the issue number.

## Status Tracking

When reporting status, use format:

```text
Task: [Task name] (#issue-number)
Epic: [Epic name]
Status: [In Progress|Blocked|Complete]
Blockers: [None|Description]
Next: [Next action item]
```

## Track-Based Worktrees (Persistent Tracks)

Enables multiple agents to work in parallel with minimal churn by keeping long-lived worktrees per track (e.g., mcp, db, devex, health) and creating short-lived feature branches per issue inside those worktrees. (Closes #39)

### Why

- Stable, dedicated folders for each focus area reduce context switching
- Clear isolation between tracks while preserving one-issue-per-PR discipline
- Faster iteration: no repeated create/remove cycles for worktrees

### Conventions (Tracks)

- Worktree root: `C:\projects\worktree\engram\{track}`
- Parking branch (empty, rarely used directly): `track/{track}`
- Base ref for new work: `origin/main`
- Feature branch per issue: `type/kebab-name-#<issue>`

Tracks (initial set): `mcp`, `db`, `devex`, `health`.

### Create Track Worktrees (one-time)

```powershell
# Preflight
git -C "C:\projects\engram" fetch origin --prune
git -C "C:\projects\engram" worktree prune
New-Item -ItemType Directory -Force -Path "C:\projects\worktree\engram" | Out-Null

# Create persistent worktrees from origin/main
git -C "C:\projects\engram" worktree add -b "track/mcp"    "C:\projects\worktree\engram\mcp"    origin/main
git -C "C:\projects\engram" worktree add -b "track/db"     "C:\projects\worktree\engram\db"     origin/main
git -C "C:\projects\engram" worktree add -b "track/devex"  "C:\projects\worktree\engram\devex"  origin/main
git -C "C:\projects\engram" worktree add -b "track/health" "C:\projects\worktree\engram\health" origin/main
```

### Per-Issue Workflow Inside a Track

```powershell
# Inside e.g. the MCP track worktree
Set-Location "C:\projects\worktree\engram\mcp"

# Always branch from origin/main for new work
git fetch origin --prune
git checkout -b "feat/mcp-sdk-handler-#23" origin/main

# Do the work, commit with single-line conventional commit message referencing the issue
git add .
git commit -m "feat(mcp): scaffold MCP SDK handler (#23)"

# Push and open PR to main
git push -u origin "feat/mcp-sdk-handler-#23"
# Create PR in GitHub with description: "Closes #23"
```

Additional example for another issue in the same track:

```powershell
git fetch origin --prune
git checkout -b "feat/mcp-tools-#24" origin/main
git commit -m "feat(mcp): add MCP tools skeleton (#24)"
git push -u origin "feat/mcp-tools-#24"
```

### Cleanup After PR Merge (Tracks)

```powershell
# After PR merges
git -C "C:\projects\engram" fetch origin --prune
git branch -D "feat/mcp-sdk-handler-#23"
git push origin --delete "feat/mcp-sdk-handler-#23"

# Worktrees remain in place for future issues; no need to recreate
```

### Guardrails and Tips

- NEVER work directly on `main`. Always create a feature branch from `origin/main`.
- Keep commits single-line, conventional, and include the issue number: `type(scope): description (#123)`
- Prefer small, focused PRs. Each issue → one PR to `main`.
- If a track is idle, leave the worktree in place; it costs nothing and saves time later.
