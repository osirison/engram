<!-- markdownlint-disable-file -->

# Implementation Details: VS Code Copilot Context Compression

## Context Reference

Sources: .copilot-tracking/research/2026-06-02/vscode-copilot-interception-research.md, .copilot-tracking/research/subagents/2026-06-02/vscode-copilot-interception-research-subagent.md, README.md, packages/embeddings/src/embeddings.module.ts, packages/memory-stm/src/memory-stm.service.ts, packages/memory-ltm/src/memory-ltm.service.ts, AGENTS.md, CLAUDE.md.

## Implementation Phase 1: Scaffold the supported extension surface

<!-- parallelizable: false -->

### Step 1.1: Create a VS Code extension workspace for the compression workflow

Add a new extension workspace under the apps tree and wire the base TypeScript project, build settings, and VS Code extension manifest. Keep the workspace separate from the existing MCP server runtime so the extension can own its own request surface.

Files:

- apps/vscode-copilot-compressor/package.json - extension manifest and contribution points.
- apps/vscode-copilot-compressor/tsconfig.json - TypeScript build settings.
- apps/vscode-copilot-compressor/src/extension.ts - extension activation entry point.

Discrepancy references:

- DD-01: Built-in Copilot interception is unsupported, so the implementation must move to a custom participant-owned workflow.

Success criteria:

- The extension workspace has a clean manifest and can activate under VS Code.
- The workspace does not depend on private Copilot internals.

Context references:

- .copilot-tracking/research/subagents/2026-06-02/vscode-copilot-interception-research-subagent.md (Lines 16-21, 61-67, 120-134) - supported versus unsupported extension surfaces.
- README.md (lines 1-80) - monorepo structure and local setup baseline.

Dependencies:

- Repo tooling for a new workspace package.
- VS Code extension API package and build tooling.

### Step 1.2: Register the supported contribution points for the new workflow

Declare the chat participant, optional prompt files, and commands that surface the compression workflow. The participant should be the primary path because it owns the request that gets sent to the model.

Files:

- apps/vscode-copilot-compressor/package.json - `contributes.chatParticipants`, `contributes.chatPromptFiles`, and `contributes.commands`.
- apps/vscode-copilot-compressor/src/extension.ts - registration glue for commands and participant.

Discrepancy references:

- DD-01: The plan uses participant-owned request handling instead of direct message interception.

Success criteria:

- Developers can invoke the workflow from a supported VS Code surface.
- The participant receives the prompt and context needed for compression.

Context references:

- .copilot-tracking/research/subagents/2026-06-02/vscode-copilot-interception-research-subagent.md (Lines 27-42, 49-55, 61-67, 74-79) - participant, instructions, prompt files, and commands.

Dependencies:

- Step 1.1 completion.
- VS Code chat participant contribution support.

### Step 1.3: Wire a custom chat participant entry point that owns the request

Implement the participant handler so the extension controls prompt shaping before any language-model request is sent. This should be the canonical entry point for automatic compression.

Files:

- apps/vscode-copilot-compressor/src/chat-participant.ts - participant handler and request routing.
- apps/vscode-copilot-compressor/src/extension.ts - participant registration.

Discrepancy references:

- DD-01: The participant owns the workflow instead of intercepting built-in Copilot traffic.

Success criteria:

- The participant receives prompt text and contextual references.
- The handler can invoke the compression pipeline before composing the final request.

Context references:

- .copilot-tracking/research/subagents/2026-06-02/vscode-copilot-interception-research-subagent.md (Lines 27-42, 120-127) - participant-owned workflow and prompt composition guidance.

Dependencies:

- Step 1.2 completion.

## Implementation Phase 2: Implement prompt compression and `caveman` shaping

<!-- parallelizable: true -->

### Step 2.1: Add a context compression pipeline that trims repeated prose, summarizes history, and enforces a token budget

Implement deterministic compression helpers that accept the current prompt, chat history, and any structured references. The output should be a shorter request that preserves intent and removes duplication.

Files:

- apps/vscode-copilot-compressor/src/context-compressor.ts - compression logic.
- apps/vscode-copilot-compressor/src/types.ts - request and compression types, if needed.

Discrepancy references:

- DD-02: The requested behavior requires automatic shrinking, which is only achievable inside an owned workflow.

Success criteria:

- Long prompts are reduced without losing the core task statement.
- Compression behavior is deterministic for the same input.

Context references:

- .copilot-tracking/research/2026-06-02/vscode-copilot-interception-research.md - suggested supported architecture and `caveman` shaping.
- packages/memory-stm/src/memory-stm.service.ts (Lines 38-84) and packages/memory-ltm/src/memory-ltm.service.ts (Lines 63-105) - non-fatal optional behavior pattern.

Dependencies:

- Step 1.3 completion.
- A clear token or character budget policy.

### Step 2.2: Add deterministic `caveman` prompt shaping so the LLM sees a concise instruction block

Convert the compressed context into a compact instruction format that forces short, direct responses when requested. Keep the transformation explicit and testable so developers can opt into the style rather than guessing what the extension will do.

Files:

- apps/vscode-copilot-compressor/src/caveman-mode.ts - instruction shaping helpers.
- apps/vscode-copilot-compressor/src/chat-participant.ts - prompt assembly.

Discrepancy references:

- DD-02: The extension must implement compression locally rather than depend on built-in Copilot prompt rewriting.

Success criteria:

- The generated prompt reliably includes the short-form style cues.
- The shaped prompt remains understandable and preserves task intent.

Context references:

- .copilot-tracking/research/subagents/2026-06-02/vscode-copilot-interception-research-subagent.md (Lines 39-42, 120-127) - prompt composition limits and supported composition path.

Dependencies:

- Step 2.1 completion.

### Step 2.3: Add optional prompt-file or command entry points for manual use cases

Provide manual launch paths for developers who want the same compression rules without using the chat participant directly. These entry points should call into the same shaping logic.

Files:

- apps/vscode-copilot-compressor/src/commands/\*.ts - command handlers.
- apps/vscode-copilot-compressor/prompts/\*.prompt.md - reusable prompt files, if adopted.

Discrepancy references:

- DR-01: Prompt files are useful but optional; they do not satisfy the automatic interception request by themselves.

Success criteria:

- Manual entry points reuse the same compression pipeline.
- Manual mode does not duplicate the core shaping logic.

Context references:

- .copilot-tracking/research/subagents/2026-06-02/vscode-copilot-interception-research-subagent.md (Lines 61-79) - prompt files and commands as supported surfaces.

Dependencies:

- Step 2.1 completion.
- Step 2.2 completion.

## Implementation Phase 3: Validate behavior and document the supported path

<!-- parallelizable: false -->

### Step 3.1: Run focused lint and type-check coverage for the new extension workspace

Validate the new workspace against the repo’s TypeScript and linting standards before expanding scope.

Validation commands:

- pnpm --filter vscode-copilot-compressor lint - extension workspace lint.
- pnpm --filter vscode-copilot-compressor typecheck - extension workspace type-check.

### Step 3.2: Add usage notes explaining that built-in Copilot interception is unsupported and the extension owns its own participant workflow

Document the supported user flow, the `caveman` mode, and the boundary between the extension-owned participant and built-in Copilot chat.

Files:

- README.md - top-level entry point or workspace notes, if the extension becomes part of the monorepo.
- apps/vscode-copilot-compressor/README.md - extension usage and limits.

### Step 3.3: Run full repository validation once the new workspace is in place

Confirm the extension does not break existing ENGRAM build, lint, or test expectations.

Validation commands:

- pnpm build - repository build.
- pnpm lint - repository lint.
- pnpm test - repository tests.

## Dependencies

- VS Code extension SDK and TypeScript toolchain.
- A decision on whether to use prompt files in addition to the primary chat participant.
- Optional `@vscode/prompt-tsx` if dynamic prompt composition becomes necessary.

## Success Criteria

- The extension owns prompt collection and shaping through a supported VS Code surface.
- The implementation produces a shorter, intent-preserving request before model submission.
- The documented user flow makes the unsupported interception boundary explicit.
