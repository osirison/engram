---
applyTo: '.copilot-tracking/changes/2026-06-04/vscode-copilot-context-compression-changes.md'
---

<!-- markdownlint-disable-file -->

# Implementation Plan: VS Code Copilot Context Compression

## Overview

Build a VS Code extension workflow that owns the chat surface, compresses developer context, and injects a deterministic `caveman`-style prompt before model submission instead of trying to intercept built-in Copilot traffic.

## Objectives

### User Requirements

- Research VS Code capabilities for Copilot message handling and build a practical extension strategy that compresses context automatically — Source: user request and .copilot-tracking/research/2026-06-02/vscode-copilot-interception-research.md.
- Preserve developer intent while shrinking verbose prompts and guiding the LLM with a focused instruction block — Source: user request.
- Use a `caveman`-style compression mode for dense developer messages — Source: user request.

### Derived Objectives

- Reject unsupported built-in Copilot interception and plan around supported VS Code surfaces only — Derived from: .copilot-tracking/research/subagents/2026-06-02/vscode-copilot-interception-research-subagent.md (Lines 16-21, 27-42, 129-134).
- Implement the experience as a custom chat participant or prompt-driven workflow that owns prompt shaping before the model call — Derived from: .copilot-tracking/research/subagents/2026-06-02/vscode-copilot-interception-research-subagent.md (Lines 61-67, 120-127).
- Align the extension architecture with ENGRAM's explicit-provider and injectable pattern rather than hidden interception — Derived from: packages/embeddings/src/embeddings.module.ts (Lines 15-42), packages/memory-stm/src/memory-stm.service.ts (Lines 38-84), packages/memory-ltm/src/memory-ltm.service.ts (Lines 63-105).

## Context Summary

### Project Files

- README.md - Confirms the monorepo layout, setup commands, and primary runtime entry points.
- packages/embeddings/src/embeddings.module.ts - Shows explicit provider selection through tokens and environment flags.
- packages/memory-stm/src/memory-stm.service.ts - Shows non-fatal optional behavior when embeddings are unavailable.
- packages/memory-ltm/src/memory-ltm.service.ts - Shows optional embeddings and source-of-truth behavior in the memory pipeline.

### References

- .copilot-tracking/research/2026-06-02/vscode-copilot-interception-research.md - Primary task research and recommended direction.
- .copilot-tracking/research/subagents/2026-06-02/vscode-copilot-interception-research-subagent.md - Verified VS Code API and Copilot extensibility boundaries.
- .copilot-tracking/research/subagents/2026-06-02/vscode-copilot-interception-research-subagent.md (Lines 16-21, 27-42, 49-55, 61-67, 74-79, 85-93, 120-134) - Evidence that direct interception is unsupported and supported alternatives exist.

### Standards References

- AGENTS.md - Monorepo and planning rules.
- CLAUDE.md - Repo-specific workflow and command guidance.
- .github/copilot-instructions.md - Root Copilot instructions and project conventions.

## Implementation Checklist

### [x] Implementation Phase 1: Scaffold the supported extension surface

<!-- parallelizable: false -->

- [x] Step 1.1: Create a VS Code extension workspace for the compression workflow.
  - Details: .copilot-tracking/details/2026-06-04/vscode-copilot-context-compression-details.md (Lines 12-31)
- [x] Step 1.2: Register the supported contribution points for the new workflow.
  - Details: .copilot-tracking/details/2026-06-04/vscode-copilot-context-compression-details.md (Lines 32-55)
- [x] Step 1.3: Wire a custom chat participant entry point that owns the request.
  - Details: .copilot-tracking/details/2026-06-04/vscode-copilot-context-compression-details.md (Lines 32-55)

### [x] Implementation Phase 2: Implement prompt compression and `caveman` shaping

<!-- parallelizable: true -->

- [x] Step 2.1: Add a context compression pipeline that trims repeated prose, summarizes history, and enforces a token budget.
  - Details: .copilot-tracking/details/2026-06-04/vscode-copilot-context-compression-details.md (Lines 56-84)
- [x] Step 2.2: Add deterministic `caveman` prompt shaping so the LLM sees a concise instruction block.
  - Details: .copilot-tracking/details/2026-06-04/vscode-copilot-context-compression-details.md (Lines 56-84)
- [x] Step 2.3: Add optional prompt-file or command entry points for manual use cases.
  - Details: .copilot-tracking/details/2026-06-04/vscode-copilot-context-compression-details.md (Lines 85-102)

### [x] Implementation Phase 3: Validate behavior and document the supported path

<!-- parallelizable: false -->

- [x] Step 3.1: Run focused lint and type-check coverage for the new extension workspace.
  - Details: .copilot-tracking/details/2026-06-04/vscode-copilot-context-compression-details.md (Lines 103-120)
- [x] Step 3.2: Add usage notes explaining that built-in Copilot interception is unsupported and the extension owns its own participant workflow.
  - Details: .copilot-tracking/details/2026-06-04/vscode-copilot-context-compression-details.md (Lines 103-120)
- [x] Step 3.3: Run full repository validation once the new workspace is in place.
  - Details: .copilot-tracking/details/2026-06-04/vscode-copilot-context-compression-details.md (Lines 103-120)

## Planning Log

See `.copilot-tracking/plans/logs/2026-06-04/vscode-copilot-context-compression-log.md` for discrepancy tracking, implementation paths considered, and follow-on work.

## Dependencies

- VS Code extension API support for chat participants and commands.
- Node.js 20+ and pnpm 11.4.0 for workspace tooling.
- Optional `@vscode/prompt-tsx` if dynamic prompt composition is needed.

## Success Criteria

- The extension owns the chat or prompt workflow and does not rely on unsupported Copilot interception — Traces to: .copilot-tracking/research/subagents/2026-06-02/vscode-copilot-interception-research-subagent.md (Lines 16-21, 27-42, 129-134).
- The extension compresses verbose user context into a concise prompt before model submission — Traces to: user request and .copilot-tracking/research/2026-06-02/vscode-copilot-interception-research.md.
- The implemented workflow can be invoked consistently by developers who want `caveman`-style compression — Traces to: user request.
