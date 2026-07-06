import { homedir } from 'node:os';
import { join } from 'node:path';

import type { BridgeConfig } from './types.js';

const DEFAULT_MCP_URL = 'http://127.0.0.1:3000/mcp';
const DEFAULT_USER_ID = 'qp';
const DEFAULT_AGENT = 'cli-bridge';
const DEFAULT_DEADLINE_MS = 2000;
const DEFAULT_DISTILL_MODEL = 'gpt-4o-mini';
const DEFAULT_DISTILL_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MAX_FACTS = 8;
const DEFAULT_DISTILL_TIMEOUT_MS = 20000;

type Env = Record<string, string | undefined>;

/** Origin (scheme://host:port) of an MCP URL — EngramClient re-appends `/mcp`. */
function toBaseUrl(mcpUrl: string): string {
  try {
    return new URL(mcpUrl).origin;
  } catch {
    return new URL(DEFAULT_MCP_URL).origin;
  }
}

function intFromEnv(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Resolve runtime config from environment variables. Recognized:
 * - `ENGRAM_URL` / `ENGRAM_MCP_URL` — MCP URL (default `http://127.0.0.1:3000/mcp`)
 * - `ENGRAM_API_KEY` — Bearer key
 * - `ENGRAM_USER_ID` — tenant (default `qp`)
 * - `ENGRAM_AGENT` — provenance label (default `cli-bridge`)
 * - `ENGRAM_TIMEOUT_MS` — per-op deadline (default 2000)
 * - `ENGRAM_SPOOL` — spool path (default `~/.engram/spool.jsonl`)
 * - `ENGRAM_DISTILL_API_KEY` / `OPENAI_API_KEY`, `ENGRAM_DISTILL_MODEL`,
 *   `ENGRAM_DISTILL_BASE_URL`, `ENGRAM_DISTILL_MAX_FACTS` — distillation
 */
export function resolveConfig(env: Env = process.env): BridgeConfig {
  const mcpUrl = env['ENGRAM_URL'] ?? env['ENGRAM_MCP_URL'] ?? DEFAULT_MCP_URL;
  return {
    baseUrl: toBaseUrl(mcpUrl),
    mcpUrl,
    apiKey: env['ENGRAM_API_KEY'] || undefined,
    userId: env['ENGRAM_USER_ID'] || DEFAULT_USER_ID,
    agent: env['ENGRAM_AGENT'] || DEFAULT_AGENT,
    deadlineMs: intFromEnv(env['ENGRAM_TIMEOUT_MS'], DEFAULT_DEADLINE_MS),
    spoolPath: env['ENGRAM_SPOOL'] || join(homedir(), '.engram', 'spool.jsonl'),
    distill: {
      apiKey: env['ENGRAM_DISTILL_API_KEY'] || env['OPENAI_API_KEY'] || undefined,
      model: env['ENGRAM_DISTILL_MODEL'] || DEFAULT_DISTILL_MODEL,
      baseUrl: env['ENGRAM_DISTILL_BASE_URL'] || DEFAULT_DISTILL_BASE_URL,
      maxFacts: intFromEnv(env['ENGRAM_DISTILL_MAX_FACTS'], DEFAULT_MAX_FACTS),
      timeoutMs: intFromEnv(env['ENGRAM_DISTILL_TIMEOUT_MS'], DEFAULT_DISTILL_TIMEOUT_MS),
    },
  };
}
