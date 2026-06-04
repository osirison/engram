<!-- markdownlint-disable-file -->

# Planning Log: VS Code Copilot Context Compression

## Discrepancy Log

Gaps and differences identified between research findings and the implementation plan.

- 2026-06-04: Initial extension typecheck failed due missing `tslib`, strict indexed-access guard, and chat history turn typing mismatch.
  - Resolution: Added `tslib`, guarded indexed reads in the compressor loop, and replaced explicit `ChatContextTurn` usage with a derived `ChatContext['history'][number]` type.
- 2026-06-04: Implemented optional in-participant model submission with fallback when no model is available.
  - Resolution: Added a language-model selection/send path using `vscode.lm.selectChatModels` and streamed model response when available.

## Implementation Paths Considered

### Selected: Participant-owned compression workflow

- Approach: Build a custom chat participant that compresses context, applies `caveman` shaping, and then sends the request through supported language-model APIs.
- Rationale: Supported by public APIs, compatible with automatic shrinking, and aligned with ENGRAM's explicit-provider design.
- Evidence: .copilot-tracking/research/subagents/2026-06-02/vscode-copilot-interception-research-subagent.md (Lines 16-21, 27-42, 61-67, 120-134).

### IP-01: Prompt files only

- Approach: Contribute reusable prompt files and ask developers to invoke them manually.
- Trade-offs: Simple and fully supported, but not automatic and therefore weaker than the requested behavior.
- Rejection rationale: Does not meet the user's intercept-and-compress goal.

### IP-02: GitHub App-based extensibility

- Approach: Move the behavior to a GitHub App Copilot extension surface.
- Trade-offs: Better cross-surface reach, but larger scope and different deployment model.
- Rejection rationale: The task asks for a local VS Code extension workflow first.

## Suggested Follow-On Work

- WI-01: Evaluate whether the extension should live as a new app workspace or a reusable package — high priority, moderate effort.
  - Source: planning phase design
  - Dependency: completion of the participant-owned workflow scaffold
- WI-02: Compare Chat Debug output and extension logs after the first participant implementation — medium priority, low effort.
  - Source: research next-step recommendation
  - Dependency: a working participant and compression pipeline
- WI-03: Research GitHub App extensibility if cross-surface Copilot support becomes a product requirement — medium priority, moderate effort.
  - Source: research note
  - Dependency: confirmation that VS Code-only support is insufficient
