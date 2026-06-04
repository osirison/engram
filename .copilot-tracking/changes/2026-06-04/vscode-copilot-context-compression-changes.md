<!-- markdownlint-disable-file -->

# Changes Log: VS Code Copilot Context Compression

## Related Plan

- .copilot-tracking/plans/2026-06-04/vscode-copilot-context-compression-plan.instructions.md

## Implementation Date

- 2026-06-04

## Summary

Implemented a new VS Code extension workspace that owns a custom chat participant, compresses context with deterministic rules, applies caveman-style prompt shaping, and optionally sends the shaped prompt through a selected VS Code language model.

## Added

- apps/vscode-copilot-compressor/package.json
- apps/vscode-copilot-compressor/tsconfig.json
- apps/vscode-copilot-compressor/.vscodeignore
- apps/vscode-copilot-compressor/README.md
- apps/vscode-copilot-compressor/prompts/caveman.prompt.md
- apps/vscode-copilot-compressor/resources/compressor.svg
- apps/vscode-copilot-compressor/src/types.ts
- apps/vscode-copilot-compressor/src/context-compressor.ts
- apps/vscode-copilot-compressor/src/caveman-mode.ts
- apps/vscode-copilot-compressor/src/chat-participant.ts
- apps/vscode-copilot-compressor/src/commands.ts
- apps/vscode-copilot-compressor/src/extension.ts

## Modified

- README.md
- pnpm-lock.yaml
- .copilot-tracking/plans/2026-06-04/vscode-copilot-context-compression-plan.instructions.md

## Validation

Focused validation:

- npm exec --yes pnpm@11.4.0 -- --filter vscode-copilot-compressor lint
- npm exec --yes pnpm@11.4.0 -- --filter vscode-copilot-compressor typecheck
- npm exec --yes pnpm@11.4.0 -- --filter vscode-copilot-compressor build

Repository validation:

- npm exec --yes pnpm@11.4.0 -- turbo run build --ui=stream --output-logs=errors-only
- npm exec --yes pnpm@11.4.0 -- turbo run lint --ui=stream --output-logs=errors-only
- npm exec --yes pnpm@11.4.0 -- turbo run typecheck --ui=stream --output-logs=errors-only
- npm exec --yes pnpm@11.4.0 -- turbo run test --ui=stream --output-logs=errors-only

## Deviations

- None. The implementation stayed within the participant-owned supported API path.
