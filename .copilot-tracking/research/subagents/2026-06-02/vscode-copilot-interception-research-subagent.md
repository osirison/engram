---
title: VS Code Copilot Interception Research
description: Verified research on whether a third-party VS Code extension can intercept, rewrite, or reshape GitHub Copilot chat messages before send
author: GitHub Copilot
ms.date: 2026-06-02
ms.topic: reference
---

## Research scope

- Determine whether a third-party extension can intercept built-in Copilot chat messages before they are sent
- Determine whether a third-party extension can modify, compress, or rewrite the message content
- Determine whether a third-party extension can inject a custom prompt or system instruction automatically
- Identify the closest supported alternative architecture when direct interception is not possible

## Executive answer

- Direct interception of built-in Copilot chat messages is not supported by any public VS Code extension API or documented GitHub Copilot extensibility surface that I found.
- A third-party extension can build its own chat participant, prompt file, command, or language-model workflow that shapes prompts before it calls the model.
- A third-party extension cannot sit in front of the built-in Copilot chat request pipeline and rewrite another participant's message before it is sent.
- The closest supported pattern is to move the interaction into a custom chat participant or prompt file, then compress context and inject instructions inside that participant before calling `request.model.sendRequest(...)` or `vscode.lm.sendRequest(...)`.

## Verified findings

### 1. No public pre-send interception hook for built-in Copilot chat

- The Chat Participant API exposes `vscode.chat.createChatParticipant(...)` and a `ChatRequestHandler` that runs only for the participant your extension contributed.
- `ChatRequest.prompt` is the user prompt for that participant. The docs note that the participant name and command are not part of the prompt.
- `ChatRequestHandler` receives the request after routing has already happened. I found no documented event, hook, or callback that allows one extension to intercept or rewrite another extension's or Copilot's built-in chat request.
- The docs also state that built-in chat participants take precedence for participant detection, which reinforces that extension routing is cooperative, not interception-based.

Relevant docs:

- [VS Code chat guide](https://code.visualstudio.com/api/extension-guides/ai/chat)
- [VS Code chat API reference](https://code.visualstudio.com/api/references/vscode-api#chat)

### 2. Message rewriting is supported only inside your own participant or prompt workflow

- A chat participant can inspect `ChatRequest.prompt`, `ChatRequest.command`, `ChatRequest.references`, `ChatRequest.toolReferences`, `ChatRequest.model`, and `ChatContext.history`.
- The participant decides whether to prepend instructions, compress history, drop context, or change the prompt before it calls the language model.
- The Language Model API supports `LanguageModelChatMessage.User(...)` and `LanguageModelChatMessage.Assistant(...)`, but the docs explicitly say the API does not support system messages.
- That means a true system-message injection point is not available through the public Language Model API. The practical substitute is a leading user instruction or always-on custom instructions.

Relevant docs:

- [VS Code language model guide](https://code.visualstudio.com/api/extension-guides/ai/language-model)
- [VS Code language model API reference](https://code.visualstudio.com/api/references/vscode-api#lm)

### 3. Custom instructions are supported, but they are not an interception API

- `.github/copilot-instructions.md` is automatically included in every chat request in the workspace.
- `AGENTS.md` is also treated as always-on instructions.
- File-based `*.instructions.md` files apply by `applyTo` pattern or manual attachment.
- These mechanisms are documented as customization features that influence prompt construction. They are not a hook for another extension to capture and edit the built-in Copilot request after the user types it.

Relevant docs:

- [Custom instructions guide](https://code.visualstudio.com/docs/agent-customization/custom-instructions)
- [Customization overview](https://code.visualstudio.com/docs/agent-customization/overview)

### 4. Prompt files and chat participants are the supported extensibility surfaces

- `contributes.chatPromptFiles` contributes reusable slash-command style prompts.
- `contributes.chatParticipants` contributes a participant that owns its own request handler, slash commands, and follow-ups.
- Prompt files are invoked manually in chat. The docs say they are unlike custom instructions, which are applied automatically.
- Chat participants can also register slash commands and follow-up prompts.
- `ChatFollowupProvider` lets a participant suggest follow-up prompts, but only within that participant's own workflow.

Relevant docs:

- [Prompt files guide](https://code.visualstudio.com/docs/agent-customization/prompt-files)
- [VS Code chat guide](https://code.visualstudio.com/api/extension-guides/ai/chat)

### 5. Command contributions and command URIs can trigger behavior, but not intercept Copilot messages

- `vscode.commands.registerCommand(...)` and `vscode.commands.executeCommand(...)` are standard extension APIs for invoking behavior.
- `command:` URIs can launch a command from markdown or UI surfaces.
- `contributes.commands` exposes commands to the Command Palette and other UI entry points.
- These are invocation mechanisms, not request-interception mechanisms. They can be used to launch your own prompt workflow, but they do not rewrite the built-in Copilot prompt in flight.

Relevant docs:

- [Commands guide](https://code.visualstudio.com/api/extension-guides/command)

### 6. GitHub Copilot can be extended, but the supported path is a GitHub App, not a local interception extension

- The VS Code chat docs state that GitHub Copilot can be extended via a GitHub App that contributes a chat participant.
- That approach works across GitHub Copilot surfaces, including github.com, Visual Studio, and VS Code.
- It does not give a local extension a hook into the built-in VS Code Copilot request stream.

Relevant docs:

- [GitHub App extensibility section](https://code.visualstudio.com/api/extension-guides/ai/chat#extending-github-copilot-via-github-apps)

## Exact API and contribution points

- `vscode.chat.createChatParticipant(participantId, handler)`
- `vscode.ChatRequestHandler`
- `vscode.ChatRequest`
- `vscode.ChatContext`
- `vscode.ChatFollowupProvider`
- `vscode.ChatResponseStream`
- `vscode.lm.selectChatModels(...)`
- `vscode.LanguageModelChatMessage.User(...)`
- `vscode.LanguageModelChatMessage.Assistant(...)`
- `vscode.LanguageModelChat.sendRequest(...)`
- `vscode.commands.registerCommand(...)`
- `vscode.commands.executeCommand(...)`
- `contributes.chatParticipants`
- `contributes.chatPromptFiles`
- `contributes.commands`
- `command:` URIs in trusted markdown

## Stable versus proposed

- Stable and documented: Chat Participant API, Language Model API, commands, command URIs, chat participant contributions, prompt file contributions, custom instructions, and custom agents.
- Preview or UI-oriented, not interception APIs: the Agent Customizations editor, parent repository discovery, and customization settings like `chat.useCustomizationsInParentRepositories`.
- I found no stable or proposed public API that exposes a pre-send or request-rewriting hook for built-in Copilot chat.

## Closest supported architecture

- Build a dedicated chat participant for the behavior you want to control.
- Add always-on instructions via `.github/copilot-instructions.md` or `AGENTS.md` for project-wide guidance.
- Add targeted `*.instructions.md` files for scoped rules, such as token compression or specialized formatting.
- Use a prompt file when the workflow should be invoked manually as a reusable slash command.
- Inside your participant, compress context before composing the prompt sent to the model. The docs explicitly recommend `@vscode/prompt-tsx` for more control over prompt composition and dynamic adaptation to context window size.
- If you need external data, use tools or MCP servers rather than trying to rewrite the built-in Copilot request.

## Practical conclusion for the user question

- A third-party extension cannot directly intercept built-in Copilot chat messages before they are sent.
- A third-party extension can only control messages that it owns, such as its own chat participant, prompt file, or command-driven workflow.
- Automatic system-prompt injection into the built-in Copilot path is not available through public APIs.
- The supported alternative is to move the experience into a custom participant and implement prompt shaping there.

## Open questions

- Whether future VS Code releases add a public pre-send hook for built-in chat remains unconfirmed.
- Whether GitHub Copilot itself will expose richer extension points beyond GitHub App-based chat participants remains a separate product question.

## Next research items

- Compare the built-in Chat Debug view and agent logs with extension APIs to confirm what is inspectable only in diagnostics versus what is programmable.
- If you want a production design, draft a participant-based architecture for context compression and prompt shaping in this repository.
- If you need cross-surface Copilot integration, research the GitHub App extensibility docs in more depth.
