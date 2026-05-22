<!-- markdownlint-disable-file -->

# Docs, Lint, and Roadmap Details

## References

- Plan: `.copilot-tracking/plans/2026-05-23/docs-lint-roadmap-plan.instructions.md`
- Research: `.copilot-tracking/research/2026-05-23/docs-lint-roadmap-research.md`
- Planning log: `.copilot-tracking/plans/logs/2026-05-23/docs-lint-roadmap-log.md`

## Phase 1 Details

- Read each missing package manifest for package name, scripts, purpose, and exports.
- Add short README files with frontmatter, overview, commands, and related docs.
- Keep examples minimal and avoid inventing unsupported behavior.

## Phase 2 Details

- Inspect `apps/mcp-server/eslint.config.mjs`, `apps/mcp-server/tsconfig.json`, package manifests, and source exports.
- Prefer deterministic source path mapping for lint/typecheck rather than relying on generated `dist` declarations.
- Validate incrementally because lint output is large and previous broad disables may hide real issues.

## Phase 3 Details

- Implement checks in `.github/check-docs.mjs` using Node built-ins only.
- Exclude `.copilot-tracking` files from frontmatter enforcement because RPI artifacts intentionally start with `<!-- markdownlint-disable-file -->`.
- Keep error output concise and actionable.

## Phase 4 Details

- Replace stale roadmap sections with current focus areas: docs quality, MCP lint/CI, memory packages, and MCP client validation.
- Keep branch and PR hygiene short and link to `AGENTS.md` for details.

## Phase 5 Details

- Use direct `node .github/check-docs.mjs` locally to avoid known `npx pnpm` side effects.
- Use targeted tool diagnostics for Markdown and JS files.
- Avoid unrelated generated output and package metadata churn.
