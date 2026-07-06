// Adapter registry (WP4 §T3). Maps each SourceTool to its adapter instance so
// the pipeline can resolve `source` → adapter. Adapters are dependency-free
// (filesystem-in / IR-out), so they are plain instances — no DI needed.

import type { SourceAdapter } from '../ir/source-adapter.interface.js';
import type { SourceTool } from '../ir/types.js';
import { ClaudeCodeAdapter } from './claude-code.adapter.js';
import { CopilotAdapter } from './copilot.adapter.js';
import { CursorAdapter } from './cursor.adapter.js';
import { CodexAdapter } from './codex.adapter.js';
import { GeminiAdapter } from './gemini.adapter.js';
import { MarkdownAdapter } from './markdown.adapter.js';

/** DI token for the injected {@link AdapterRegistry}. */
export const ADAPTER_REGISTRY = Symbol.for('engram.memory-import.adapter-registry');

export type AdapterRegistry = ReadonlyMap<SourceTool, SourceAdapter>;

/** Build the default registry with one instance of every source adapter. */
export function buildAdapterRegistry(): AdapterRegistry {
  const adapters: SourceAdapter[] = [
    new ClaudeCodeAdapter(),
    new CopilotAdapter(),
    new CursorAdapter(),
    new CodexAdapter(),
    new GeminiAdapter(),
    new MarkdownAdapter(),
  ];
  return new Map(adapters.map((a) => [a.tool, a]));
}
