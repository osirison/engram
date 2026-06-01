<!-- markdownlint-disable-file -->

# Docs, Lint, and Roadmap Research

## Scope

Continue all prior suggested work items:

1. Document remaining packages.
2. Fix MCP server lint debt.
3. Expand docs validation.
4. Refresh roadmap accuracy.

## Difficulty

Medium-hard. The documentation work is straightforward, but the lint item affects TypeScript package resolution, app source, tests, and CI confidence.

## Instructions Consulted

- `AGENTS.md`
- `.github/copilot-instructions.md`
- `/home/qp/.vscode/extensions/ise-hve-essentials.hve-core-all-3.2.2/.github/instructions/hve-core/markdown.instructions.md`
- `/home/qp/.vscode/extensions/ise-hve-essentials.hve-core-all-3.2.2/.github/instructions/hve-core/writing-style.instructions.md`
- `/home/qp/.vscode/extensions/ise-hve-essentials.hve-core-all-3.2.2/.github/instructions/coding-standards/python-script.instructions.md` (only if Python files become relevant; current plan avoids Python)

## Evidence Log

- Current package manifests show 11 packages under `packages/*`, but only four package READMEs exist: `database`, `embeddings`, `eslint-config`, and `redis`.
- Existing app READMEs and package docs were normalized in the previous pass; current follow-up should avoid reintroducing unrelated package license metadata churn.
- `.github/check-docs.mjs` currently validates local Markdown links and correct Copilot instruction filename only.
- `docs/roadmap.md` still describes old issue waves and Windows worktree details that conflict with the simplified onboarding guidance.
- Researcher Subagent found the MCP server lint burst is mostly a type-resolution cascade: workspace package `types` fields point to `dist/index.d.ts`, but generated declarations are missing or stale locally, so imports become `error` typed under type-aware ESLint.

## Selected Approach

- Add concise README files for packages missing documentation, using the same frontmatter and command-table style as the normalized docs.
- Fix MCP lint at the root by making mcp-server TypeScript/ESLint resolve workspace packages to source during local checks, then remove obsolete broad disables and address real residual diagnostics.
- Expand `.github/check-docs.mjs` with lightweight checks for frontmatter, duplicate headings, and local link existence without adding dependencies.
- Rewrite `docs/roadmap.md` into a current, short execution roadmap aligned with the repo state and current developer workflow.

## Alternatives Considered

- Build all workspace package declarations before lint. Rejected as the primary approach because it leaves lint behavior dependent on generated, ignored `dist` state.
- Add a third-party markdown checker. Rejected for now to keep validation dependency-free and low-risk.

## Validation Targets

- `node .github/check-docs.mjs`
- targeted Markdown diagnostics through VS Code `get_errors`
- mcp-server lint/type checks after type-resolution edits
- `git diff --check`
