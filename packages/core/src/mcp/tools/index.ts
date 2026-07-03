/**
 * MCP Tools Registry
 * Manages registration and execution of MCP tools
 */

import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '../types.js';
import { pingTool } from './ping.tool.js';

/**
 * How an authenticated identity maps onto a tool:
 *   - `identity` (default): the tool acts on behalf of the caller. When the
 *     request is authenticated, the verified `userId` is injected into the tool
 *     input, overriding any client-supplied `userId` (a forged tenant cannot
 *     read another tenant's data).
 *   - `admin`: `userId` is a parameter chosen by an operator (e.g. issuing an
 *     API key *for* a user); it is never overwritten. These tools carry their
 *     own `adminToken` gate.
 *   - `public`: callable without authentication (e.g. `ping`).
 */
export type ToolAuthMode = 'identity' | 'admin' | 'public';

/**
 * Tool definition interface
 */
export interface Tool {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  handler: (input: unknown) => Promise<unknown>;
  /** Defaults to `identity`. See {@link ToolAuthMode}. */
  auth?: ToolAuthMode;
  /**
   * Scope an authenticated principal must hold to call this tool (e.g.
   * `memories:write`). The `admin` scope satisfies any requirement. Only
   * checked when the request carries an authenticated identity; tools with no
   * `requiredScope` need only a valid identity. Leaves unauthenticated/legacy
   * calls (no authInfo) to the `auth` enforcement above.
   */
  requiredScope?: string;
}

/**
 * Server-wide authentication policy applied during tool dispatch. Supplied by
 * the host (derived from `AUTH_REQUIRED` + transport). When `required` is true,
 * non-public tools reject requests that carry no authenticated identity.
 */
export interface AuthPolicy {
  required: boolean;
}

/** Shape of the per-request auth info forwarded by the transport. */
type ToolCallExtra =
  | { authInfo?: { scopes?: unknown; extra?: Record<string, unknown> } }
  | undefined;

/** Read the verified user id stashed on the transport's auth info, if any. */
function authenticatedUserId(extra: ToolCallExtra): string | undefined {
  const value = extra?.authInfo?.extra?.userId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Read the authenticated principal's granted scopes, if any. */
function authenticatedScopes(extra: ToolCallExtra): string[] {
  const scopes = extra?.authInfo?.scopes;
  return Array.isArray(scopes) ? scopes.filter((s): s is string => typeof s === 'string') : [];
}

/** The `admin` scope is a universal grant. */
const ADMIN_SCOPE = 'admin';

/** Whether a tool's input schema declares a `userId` we can safely inject. */
function schemaAcceptsUserId(schema: z.ZodSchema): boolean {
  return (
    schema instanceof z.ZodObject && Object.prototype.hasOwnProperty.call(schema.shape, 'userId')
  );
}

/**
 * Registry of built-in tools
 */
const builtInTools: Tool[] = [pingTool];

/**
 * JSON Schema advertised for a tool's input via `tools/list`. MCP requires
 * the top level to be an object schema (`"type": "object"`); everything else
 * (properties, required, additionalProperties, $schema, …) is draft-07.
 */
export type ToolInputJsonSchema = { type: 'object' } & Record<string, unknown>;

/**
 * Convert a tool's Zod input schema to the JSON Schema (draft-07) shape
 * advertised to MCP clients via `tools/list`.
 *
 * Uses Zod v4's native `z.toJSONSchema()` so every construct tools actually
 * use — enums, arrays, nested objects/records, `.default()`, `.nullable()`,
 * `.optional()`, coerced numbers — produces a correct `properties` entry and
 * an accurate `required` list. (The previous hand-rolled converter only
 * emitted string/number/boolean properties and marked `ZodDefault` fields as
 * required while omitting them from `properties`.)
 */
export function zodToJsonSchema(schema: z.ZodSchema): ToolInputJsonSchema {
  const jsonSchema = z.toJSONSchema(schema, {
    // MCP clients broadly understand draft-07.
    target: 'draft-7',
    // Describe what the *client sends*: a field with `.default()` is always
    // present in the parsed output but optional on input, so it must appear
    // in `properties` (with its default) and must NOT be listed in `required`.
    io: 'input',
    // Inputs with no JSON representation (e.g. `z.coerce.date()`) degrade to
    // an unconstrained `{}` property instead of throwing; server-side Zod
    // validation still enforces the real constraints on every call.
    unrepresentable: 'any',
  }) as Record<string, unknown>;

  if (jsonSchema['type'] !== 'object') {
    // MCP tool input schemas must be object-typed at the top level. All tools
    // use `z.object(...).strict()`, so this is a defensive fallback for
    // non-object schemas rather than advertising an invalid shape.
    return { type: 'object' };
  }

  return jsonSchema as ToolInputJsonSchema;
}

/**
 * Register all MCP tools with the server
 * @param server - MCP server instance
 * @param additionalTools - Optional array of additional tools to register
 */
export function registerTools(
  server: McpServer,
  additionalTools: Tool[] = [],
  authPolicy: AuthPolicy = { required: false }
): void {
  const logger = new Logger('McpTools');

  // Combine built-in and additional tools
  const allTools = [...builtInTools, ...additionalTools];

  // Register list_tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.log('Handling tools/list request');

    return {
      tools: allTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: zodToJsonSchema(tool.inputSchema),
      })),
    };
  });

  // Register call_tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const toolName = request.params.name;
    logger.log(`Handling tools/call request for tool: ${toolName}`);

    try {
      // Find the tool
      const tool = allTools.find((t) => t.name === toolName);
      if (!tool) {
        logger.error(`Unknown tool: ${toolName}`);
        throw new Error(`Unknown tool: ${toolName}`);
      }

      const mode: ToolAuthMode = tool.auth ?? 'identity';
      const userId = authenticatedUserId(extra);

      // Enforcement: protected tools require an authenticated identity when the
      // server policy demands it. (The HTTP layer rejects these earlier with a
      // 401; this is the in-dispatch safety net so no protected tool can run
      // unauthenticated even if the request reaches the handler.)
      if (authPolicy.required && mode !== 'public' && !extra?.authInfo) {
        logger.warn(`auth_required_denied tool=${toolName}`);
        throw new Error('Unauthorized: authentication is required');
      }

      // Scope check: an authenticated principal must hold the tool's required
      // scope (or the universal `admin` scope). This makes API-key/JWT scopes
      // load-bearing — e.g. a `memories:read`-only key cannot call a write or
      // delete tool. Unauthenticated/legacy calls (no authInfo) are governed by
      // the auth-required check above, not here.
      if (extra?.authInfo && mode !== 'public' && tool.requiredScope) {
        const scopes = authenticatedScopes(extra);
        if (!scopes.includes(ADMIN_SCOPE) && !scopes.includes(tool.requiredScope)) {
          logger.warn(`scope_denied tool=${toolName} required=${tool.requiredScope}`);
          throw new Error(`Forbidden: missing required scope "${tool.requiredScope}"`);
        }
      }

      // Build the effective input. For identity tools we trust the verified
      // userId over anything the client supplied — the tenant boundary is the
      // token, not the request body.
      let args: unknown = request.params.arguments ?? {};
      if (mode === 'identity' && userId && schemaAcceptsUserId(tool.inputSchema)) {
        args = { ...(args as Record<string, unknown>), userId };
      }

      // Validate input with Zod
      const validatedInput = tool.inputSchema.parse(args);

      // Execute tool handler
      const result = await tool.handler(validatedInput);

      logger.log(`Tool ${toolName} executed successfully`);

      // Check if result is already in MCP format (has content array)
      if (
        result &&
        typeof result === 'object' &&
        'content' in result &&
        Array.isArray(result.content)
      ) {
        // Result is already in MCP format, return as-is
        return result as { content: Array<{ type: string; text: string }> };
      }

      // Wrap simple result in MCP format
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error(`Error executing tool ${toolName}:`, error);

      // Format error response
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: errorMessage }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  logger.log(
    `Registered ${allTools.length} MCP tools (${builtInTools.length} built-in, ${additionalTools.length} additional)`
  );
}
