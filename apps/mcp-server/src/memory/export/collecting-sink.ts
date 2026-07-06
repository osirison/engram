import type { ExportSink } from './export.types';

/**
 * {@link ExportSink} that accumulates files in memory. Used by the MCP tool to
 * decide, after the export runs, whether the result fits inline (return the
 * documents as JSON) or must be flushed to a server path (avoid blowing the MCP
 * token budget with a huge inline payload — PLAN §4.11).
 */
export class CollectingSink implements ExportSink {
  readonly files = new Map<string, string>();

  writeFile(relativePath: string, content: string): void {
    this.files.set(relativePath, content);
  }

  /** Plain `{ relativePath: content }` view for JSON serialization. */
  toObject(): Record<string, string> {
    return Object.fromEntries(this.files);
  }
}
