---
title: Agent Memory Client Wiring
description: Per-agent wiring to make ENGRAM the primary shared memory for Claude Code, GitHub Copilot, Cursor, OpenAI Codex, and Gemini — with each client's verified MCP config and recall/store guarantee
---

# Agent Memory Client Wiring

How each of the five AI coding agents connects to the one persistent ENGRAM
server ([`agent-memory-server.md`](./agent-memory-server.md)) and follows the
[Agent Memory Contract](./agent-memory-contract.md). Every agent authenticates
with its own API key ([`security/agent-keys.md`](./security/agent-keys.md)) and
uses `userId: "qp"`.

**Guarantee legend:** 🟢 deterministic (a hook forces recall/store) ·
🔴 best-effort (the model must choose to follow the directive; the platform has
no memory hook). Only **Claude Code** is 🟢 today.

| Agent          | MCP config                | Directive file                    | Recall/store |
| -------------- | ------------------------- | --------------------------------- | ------------ |
| Claude Code    | `.mcp.json`               | `CLAUDE.md`                       | 🟢 / 🟢      |
| GitHub Copilot | `.vscode/mcp.json`        | `.github/copilot-instructions.md` | 🔴 / 🔴      |
| Cursor         | `.cursor/mcp.json`        | `.cursor/rules/engram-memory.mdc` | 🔴 / 🔴      |
| OpenAI Codex   | `~/.codex/config.toml`    | `AGENTS.md`                       | 🔴 / 🔴      |
| Gemini CLI     | `~/.gemini/settings.json` | `GEMINI.md`                       | 🔴 / 🔴      |

> Config formats for the non-Claude clients were verified against each vendor's
> current (July 2026) docs, but they drift — re-check the vendor doc if a client
> reports a bad config. Set `ENGRAM_API_KEY` in the environment each client is
> launched from; never commit a key.

## Claude Code (CLI) — 🟢 deterministic

The only agent with a machine-enforced automatic loop (session hooks). Three
pieces, all checked in:

1. **MCP wiring** — root `.mcp.json` registers the `engram` HTTP server. The
   `Authorization` header uses `Bearer ${ENGRAM_API_KEY:-}` (the `:-` default
   keeps the file parseable when the key is unset — Claude Code fails to parse a
   config that references an unset variable with no default).
2. **Hook scripts** — `.claude/hooks/engram-recall.sh` (SessionStart) prints a
   recalled-memory block that Claude Code injects into context;
   `.claude/hooks/engram-capture.sh` (SessionEnd) distills the finished session
   into memories. Both shell out to the `engram` CLI
   ([`packages/agent-bridge`](./agent-memory-contract.md)) and **always exit 0** —
   whether the CLI is missing or the server is down — so a session is never
   blocked. `scripts/test-engram-hooks.sh` asserts this contract.
3. **Directive** — the ENGRAM contract block is appended to `CLAUDE.md`.

**This repo ships "live tools, hooks opt-in":** the `engram` MCP tools are
available (via `.mcp.json`) and the hook scripts are present, but the SessionStart
/ SessionEnd hooks are **not** wired, so nothing runs automatically until you opt
in. This avoids surprising session-start latency and per-session LLM distillation
cost.

### Make Claude Code fully live

Add this to `.claude/settings.json` (project or user scope) to turn on automatic
recall-at-start and capture-at-end:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/engram-recall.sh",
            "timeout": 15
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/engram-capture.sh",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Automatic capture only stores when a distillation LLM key is configured
(`ENGRAM_DISTILL_API_KEY` or `OPENAI_API_KEY`); otherwise it is a no-op. The
transcript format Claude Code writes is an internal detail that can change between
releases, so `capture` parses it tolerantly and stores nothing if it can't.

**Verify:** start a session in a temp repo with the hooks enabled and the server
running — a recall block appears at start; end the session and confirm a fact was
stored (`engram recall "<something from the session>"`). With the server down,
the session is unaffected.

## GitHub Copilot (VS Code) — 🔴 best-effort

Copilot Agent mode can _call_ MCP tools, but VS Code cannot intercept Copilot
chat traffic, so recall/store depend on the model following the directive. Config
lives in `.vscode/mcp.json` under the top-level `servers` key (VS Code uses
`servers`, not `mcpServers`), with the key supplied via an `inputs` prompt:

```json
{
  "servers": {
    "engram": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": { "Authorization": "Bearer ${input:engram-key}" }
    }
  },
  "inputs": [
    {
      "id": "engram-key",
      "type": "promptString",
      "description": "ENGRAM API key",
      "password": true
    }
  ]
}
```

The directive is appended to `.github/copilot-instructions.md`, which VS Code
auto-applies to all workspace chat requests.

**Verify:** switch Copilot Chat to **Agent** mode → confirm `engram` tools are
listed; do a manual `remember` then `recall` round-trip.

## Cursor — 🔴 best-effort

Two project files: `.cursor/mcp.json` registers the remote server (Cursor
auto-detects Streamable HTTP from the presence of `url`; no `type` needed), and
`.cursor/rules/engram-memory.mdc` is an always-applied rule (`alwaysApply: true`)
carrying the directive. Cursor's env-var interpolation syntax is `${env:NAME}`:

```json
{
  "mcpServers": {
    "engram": {
      "url": "http://127.0.0.1:3000/mcp",
      "headers": { "Authorization": "Bearer ${env:ENGRAM_API_KEY}" }
    }
  }
}
```

**Fallback:** header interpolation only resolves if Cursor inherited
`ENGRAM_API_KEY` at launch (a desktop-launched Cursor may not see shell env). If
the header does not resolve, launch Cursor from a terminal that exports the key,
or switch `engram` to the `mcp-remote` stdio bridge (`command: "npx"`,
`args: ["mcp-remote", "http://127.0.0.1:3000/mcp", "--header", "Authorization: Bearer ${env:ENGRAM_API_KEY}"]`),
where interpolation is reliable.

**Verify:** Cursor Settings → MCP shows `engram` Connected with its tools; the
`engram-memory` rule shows as an Always rule; ask the agent to call `recall`.

## OpenAI Codex CLI — 🔴 best-effort

Config is the home-dir file `~/.codex/config.toml` (not committed). Current Codex
supports a native streamable-HTTP transport by `url`; `bearer_token_env_var`
sends the env var's value as `Authorization: Bearer <value>`, so `ENGRAM_API_KEY`
must hold the **raw** key (no `Bearer ` prefix):

```toml
[mcp_servers.engram]
url = "http://127.0.0.1:3000/mcp"
bearer_token_env_var = "ENGRAM_API_KEY"
# experimental_use_rmcp_client = true   # only on older builds that gate HTTP
```

For builds without working native HTTP, use the `mcp-remote` stdio bridge
(`command = "npx"`, `args = ["-y", "mcp-remote", "http://127.0.0.1:3000/mcp", "--header", "Authorization: Bearer ${ENGRAM_API_KEY}"]`).
Codex auto-reads `AGENTS.md` (git-root → cwd), where the directive lives.

**Verify:** `codex mcp list` shows `engram`; in a session, confirm the ENGRAM
tools are listed and `recall` returns a result set (empty is a valid pass).

## Gemini CLI — 🔴 best-effort

Config is `~/.gemini/settings.json` (global) or `.gemini/settings.json` (project).
HTTP servers use the **`httpUrl`** key (not `url`, which selects SSE):

```json
{
  "mcpServers": {
    "engram": {
      "httpUrl": "http://127.0.0.1:3000/mcp",
      "headers": { "Authorization": "Bearer $ENGRAM_API_KEY" }
    }
  }
}
```

The directive lives in `GEMINI.md`, which Gemini CLI auto-loads as hierarchical
context. Gemini CLI has `SessionStart` / `BeforeAgent` hooks that can emit
`hookSpecificOutput.additionalContext` — configuring one to inject a
`load_context` result would upgrade recall from best-effort to deterministic (not
shipped here).

**Verify:** `/mcp` in Gemini CLI lists `engram`; `/memory show` shows the
directive from `GEMINI.md`; ask Gemini to call `load_context` for the project.

## Claude Desktop (bonus) — tools only

Claude Desktop is stdio-only, has no hooks, and does not read `CLAUDE.md`. It can
only make the tools _available_ on demand via an `mcp-remote` stdio bridge in
`claude_desktop_config.json` (see [`SETUP.md`](./SETUP.md) for config-file
locations). No automatic store/recall — not a WP5 acceptance target.
