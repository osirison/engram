declare module '@modelcontextprotocol/sdk/server/streamableHttp.js' {
  import type { IncomingMessage, ServerResponse } from 'node:http';
  import type {
    JSONRPCMessage,
    MessageExtraInfo,
  } from '@modelcontextprotocol/sdk/types.js';
  import type {
    Transport,
    TransportSendOptions,
  } from '@modelcontextprotocol/sdk/shared/transport.js';

  export interface StreamableHTTPServerTransportOptions {
    sessionIdGenerator?: (() => string) | undefined;
    onsessioninitialized?: (sessionId: string) => void | Promise<void>;
    enableJsonResponse?: boolean;
  }

  export class StreamableHTTPServerTransport implements Transport {
    constructor(options?: StreamableHTTPServerTransportOptions);
    start(): Promise<void>;
    send(
      message: JSONRPCMessage,
      options?: TransportSendOptions,
    ): Promise<void>;
    close(): Promise<void>;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: <T extends JSONRPCMessage>(
      message: T,
      extra?: MessageExtraInfo,
    ) => void;
    sessionId?: string;
    setProtocolVersion?: (version: string) => void;
    handleRequest(
      req: IncomingMessage & { auth?: unknown },
      res: ServerResponse,
      parsedBody?: unknown,
    ): Promise<void>;
  }
}
