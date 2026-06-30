import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * A small, generic MCP tool caller for the ENGRAM server.
 *
 * `@engram/client` only wraps the high-level agent tools (remember/recall/…),
 * so the dashboard needs its own thin client to reach `update_memory`,
 * `delete_memory`, and `recall`. It owns one lazily-established Streamable HTTP
 * session and re-connects if a call fails (e.g. the server restarted).
 */

type ContentItem = { type: string; text?: string };

export interface McpClientOptions {
  baseUrl: string;
  apiKey?: string | null;
}

export class McpToolClient {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  constructor(private readonly options: McpClientOptions) {}

  private async ensureClient(): Promise<Client> {
    if (this.client) return this.client;
    if (!this.connecting) {
      const client = new Client(
        { name: '@engram/dashboard', version: '0.1.0' },
        { capabilities: {} }
      );
      const requestInit: RequestInit = this.options.apiKey
        ? { headers: { Authorization: `Bearer ${this.options.apiKey}` } }
        : {};
      const transport = new StreamableHTTPClientTransport(new URL('/mcp', this.options.baseUrl), {
        requestInit,
      });
      this.connecting = client
        .connect(transport)
        .then(() => {
          this.client = client;
          return client;
        })
        .catch((error) => {
          this.connecting = null;
          throw error;
        });
    }
    return this.connecting;
  }

  /** Drop the cached session so the next call reconnects. */
  private reset(): void {
    this.client = null;
    this.connecting = null;
  }

  /**
   * Call a tool and return its first text payload parsed as JSON.
   * Throws on MCP/tool errors with the server-provided message.
   */
  async call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    let client: Client;
    try {
      client = await this.ensureClient();
    } catch (error) {
      this.reset();
      throw new Error(
        `Could not connect to the ENGRAM server: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    let result;
    try {
      result = await client.callTool({ name, arguments: args });
    } catch (error) {
      // A transport-level failure invalidates the session — reset for next time.
      this.reset();
      throw new Error(
        `MCP tool "${name}" failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const content = (result.content ?? []) as ContentItem[];
    const text = content.find((item) => item.type === 'text')?.text ?? '';

    if (result.isError) {
      let message = text || `MCP tool "${name}" returned an error`;
      try {
        const parsed = JSON.parse(text) as { error?: string; message?: string };
        message = parsed.error ?? parsed.message ?? message;
      } catch {
        // text was not JSON — use as-is
      }
      throw new Error(message);
    }

    if (!text) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }
}
