import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';

import type {
  RememberInput,
  RememberResult,
  RecallInput,
  RecallResult,
  ForgetInput,
  ForgetResult,
  ReflectInput,
  ReflectResult,
  PromptContextInput,
  PromptContextResult,
  IngestConversationInput,
  IngestConversationResult,
} from './types.js';

export interface EngramClientOptions {
  /** Base URL of the ENGRAM server, e.g. 'http://localhost:3000' */
  baseUrl: string;
  /** API key sent as `Authorization: Bearer <apiKey>` */
  apiKey?: string;
  /** Custom fetch implementation — for testing or environments without native fetch */
  fetch?: FetchLike;
}

type ContentItem = { type: string; text: string };

export class EngramClient {
  private readonly _client: Client;
  private readonly _transport: Transport;
  private _connected = false;
  private _connectPromise: Promise<void> | null = null;

  constructor(options: EngramClientOptions, transport?: Transport) {
    this._client = new Client({ name: '@engram/client', version: '0.1.0' }, { capabilities: {} });

    if (transport) {
      this._transport = transport;
    } else {
      const requestInit: RequestInit = options.apiKey
        ? { headers: { Authorization: `Bearer ${options.apiKey}` } }
        : {};
      this._transport = new StreamableHTTPClientTransport(new URL('/mcp', options.baseUrl), {
        requestInit,
        fetch: options.fetch,
      });
    }
  }

  private _ensureConnected(): Promise<void> {
    if (this._connected) return Promise.resolve();
    if (!this._connectPromise) {
      this._connectPromise = this._client.connect(this._transport).then(() => {
        this._connected = true;
      });
    }
    return this._connectPromise;
  }

  private async _callTool(name: string, args: Record<string, unknown>): Promise<ContentItem[]> {
    await this._ensureConnected();
    const result = await this._client.callTool({ name, arguments: args });
    if (result.isError) {
      const errText = (result.content as ContentItem[])[0]?.text ?? 'Unknown MCP tool error';
      let errMsg = errText;
      try {
        const parsed = JSON.parse(errText) as { error?: string };
        if (parsed.error) errMsg = parsed.error;
      } catch {
        // errText is plain text
      }
      throw new Error(errMsg);
    }
    return result.content as ContentItem[];
  }

  async remember(input: RememberInput): Promise<RememberResult> {
    const content = await this._callTool('remember', input as unknown as Record<string, unknown>);
    return JSON.parse(content[0]!.text) as RememberResult;
  }

  async recall(input: RecallInput): Promise<RecallResult> {
    const content = await this._callTool('recall', input as unknown as Record<string, unknown>);
    return JSON.parse(content[0]!.text) as RecallResult;
  }

  async forget(input: ForgetInput): Promise<ForgetResult> {
    const content = await this._callTool('forget', input as unknown as Record<string, unknown>);
    return JSON.parse(content[0]!.text) as ForgetResult;
  }

  async reflect(input: ReflectInput): Promise<ReflectResult> {
    const content = await this._callTool('reflect', input as unknown as Record<string, unknown>);
    return JSON.parse(content[0]!.text) as ReflectResult;
  }

  async promptContext(input: PromptContextInput): Promise<PromptContextResult> {
    const content = await this._callTool(
      'prompt_context',
      input as unknown as Record<string, unknown>
    );
    const contextText = content[0]!.text;
    const meta = JSON.parse(content[1]!.text) as Omit<PromptContextResult, 'context'>;
    return { context: contextText, ...meta };
  }

  async ingestConversation(input: IngestConversationInput): Promise<IngestConversationResult> {
    const content = await this._callTool(
      'ingest_conversation',
      input as unknown as Record<string, unknown>
    );
    return JSON.parse(content[0]!.text) as IngestConversationResult;
  }

  async close(): Promise<void> {
    if (this._connected) {
      await this._client.close();
      this._connected = false;
    }
  }
}
