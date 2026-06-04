---
title: VS Code Copilot Context Compressor
description: Supported extension workflow for deterministic context compression and caveman prompt shaping
---

## Overview

This workspace provides a VS Code extension that owns its own chat participant workflow and compresses verbose developer prompts into deterministic `caveman`-style prompt output.

Built-in GitHub Copilot chat traffic interception is not supported by VS Code extension APIs. This extension uses supported contribution points instead.

## What It Contributes

- Chat participant: `@compressor` via `engram.compressor`.
- Chat prompt file: `prompts/caveman.prompt.md`.
- Manual commands:
  - `Copilot Compressor: Compress Selected Text`
  - `Copilot Compressor: Compress Prompt From Input`

## Usage

1. Build the workspace with `pnpm --filter vscode-copilot-compressor build`.
2. Launch the extension host from this workspace in VS Code.
3. Open chat and invoke the participant with `@compressor /compress`.
4. Provide verbose context. The participant returns a compressed caveman-style prompt block.

For manual mode, run one of the command palette commands and paste the result into your model call path.

## Configuration

- `engram.copilotCompressor.maxPromptChars`: character budget before shaping, default `1400`.
- `engram.copilotCompressor.includeHistory`: include prior user turns, default `true`.

## Boundaries

- Supported: participant-owned request handling, command-triggered compression, prompt files.
- Unsupported: intercepting or rewriting built-in Copilot participant traffic.
