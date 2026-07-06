// The contract every source adapter implements (WP4 PLAN §T1 step 3). `parse`
// is filesystem-in / IR-out with NO database access — this is what lets each
// adapter (T6–T11) be built and unit-tested fully in parallel, integrating only
// through the pipeline's adapter registry (T3).

import type { ImportIR, SourceTool } from './types.js';

/** Options threaded from the CLI/MCP run into each adapter parse. */
export interface ParseOptions {
  /** Correlates every fact/link/ledger row written by one run. */
  importBatchId: string;
  /**
   * ISO-8601 UTC timestamp for this run, supplied by the caller (T3) rather than
   * read from the clock inside the adapter — keeps `parse()` deterministic and
   * its fixtures stable.
   */
  importedAt: string;
  /** Machine host recorded in provenance (optional). */
  host?: string;
  /**
   * Opt into H2 chunking for sources that default to 1-file-1-memory (generic
   * markdown vaults, focused rule files). Ignored by always-chunked sources.
   */
  splitHeadings?: boolean;
  /**
   * Include the user-global instruction file for hierarchy sources
   * (`~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`). Off by default.
   */
  includeGlobal?: boolean;
}

export interface SourceAdapter {
  /** Which `SourceTool` this adapter handles; the registry key (T3). */
  readonly tool: SourceTool;
  /** Cheap heuristic: does `path` look like this tool's on-disk layout? */
  detect(path: string): Promise<boolean>;
  /** Parse `path` into the common IR. No DB access. */
  parse(path: string, opts: ParseOptions): Promise<ImportIR>;
}
