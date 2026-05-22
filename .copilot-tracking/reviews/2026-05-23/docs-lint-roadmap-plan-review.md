<!-- markdownlint-disable-file -->

# Docs, Lint, and Roadmap Review

## Metadata

- Plan: `.copilot-tracking/plans/2026-05-23/docs-lint-roadmap-plan.instructions.md`
- Changes: `.copilot-tracking/changes/2026-05-23/docs-lint-roadmap-changes.md`
- Reviewer: GitHub Copilot
- Date: 2026-05-23

## User Request Fulfillment

| Request                     | Status   | Evidence                                                                                                                   |
| --------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| Document remaining packages | Complete | Added READMEs for config, core, memory-ltm, memory-stm, vector-store, ui, and typescript-config packages.                  |
| Fix MCP server lint debt    | Complete | Added source-resolution check tsconfig, pointed ESLint at it, removed stale suppressions, and fixed typed test assertions. |
| Expand docs validation      | Complete | `.github/check-docs.mjs` now checks frontmatter, duplicate headings, local links, and Copilot instruction filename.        |
| Refresh roadmap accuracy    | Complete | Rewrote `docs/roadmap.md` around current docs, MCP quality, memory packages, and client validation tracks.                 |
| Keep setup simple           | Complete | Root README and linked docs remain short, command-focused, and organized by next destination.                              |

## Placement and Quality Findings

- Documentation updates are in the relevant root, app, package, and docs locations rather than overloading the root README.
- Docs validation remains dependency-free and runs from the existing root `docs:check` script and CI step.
- MCP server package source mappings are isolated in `apps/mcp-server/tsconfig.check.json`; the build tsconfig no longer carries source paths or deprecated `baseUrl` usage.
- No unrelated license metadata or generated credential changes remain in the final manifest diff.

## Validation Results

- `node .github/check-docs.mjs`: passed.
- `apps/mcp-server`: `../../node_modules/.bin/tsc -p tsconfig.check.json --noEmit --pretty false`: passed.
- `apps/mcp-server`: `../../node_modules/.bin/eslint "{src,apps,libs,test}/**/*.ts" --format stylish`: passed.
- `apps/mcp-server`: focused Jest run for changed memory and health tests: passed, 5 suites and 86 tests.
- `git diff --check`: passed.
- VS Code diagnostics for final touched docs/config/script files: passed after Markdown formatting and tsconfig cleanup.

## Residual Risk

- Full repo `pnpm build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` were not run because this workspace has shown local `npx pnpm` side effects; targeted local binaries were used instead.
- The new MCP server `typecheck` script improves Turbo coverage, but full CI should still confirm all workspace tasks together.

## Overall Status

Complete.
