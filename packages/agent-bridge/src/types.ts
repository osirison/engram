import type { RememberInput } from '@engram/client';

/** Resolved runtime configuration for the `engram` bridge CLI. */
export interface BridgeConfig {
  /** Server origin passed to EngramClient (it appends `/mcp`). */
  baseUrl: string;
  /** Full MCP URL, for logging/diagnostics. */
  mcpUrl: string;
  /** Per-agent API key sent as `Authorization: Bearer <key>`. */
  apiKey?: string;
  /** Tenant — always lowercase-alphanumeric (cuid2). Default `qp`. */
  userId: string;
  /** Provenance label stamped into `metadata.agent` (e.g. `claude-code`). */
  agent: string;
  /** Hard deadline per network operation, in ms. Keeps a dead server from adding latency. */
  deadlineMs: number;
  /** Absolute path of the local spool file. */
  spoolPath: string;
  /** Bounded-distillation (LLM) configuration for `capture`. */
  distill: DistillConfig;
}

export interface DistillConfig {
  /** LLM API key. When absent, `capture` distillation is disabled (no-op). */
  apiKey?: string;
  model: string;
  /** OpenAI-compatible base URL, e.g. `https://api.openai.com/v1`. */
  baseUrl: string;
  /** Max facts to extract from one session. */
  maxFacts: number;
  /** Hard timeout for the distillation HTTP call, in ms (keeps `capture` non-blocking). */
  timeoutMs?: number;
}

/** A pending write queued locally when the server was unreachable. */
export interface SpoolEntry {
  idempotencyKey: string;
  tool: 'remember';
  payload: RememberInput;
  spooledAt: string;
}

/** One memory-worthy fact produced by the distillation pass. */
export interface DistilledFact {
  content: string;
  scope?: string;
  tags?: string[];
  importance?: number;
}
