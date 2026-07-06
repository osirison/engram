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
 *     read another tenant's data). Exception: on a tool that opts in with
 *     `delegable: true`, a principal holding the `admin` scope may *delegate* —
 *     explicitly pass another tenant's `userId` and have it honoured (see
 *     {@link resolveActingUserId}); such calls are audited. Identity tools that
 *     do not set `delegable` pin every caller, admin included, to their own
 *     tenant.
 *   - `admin`: `userId` is a parameter chosen by an operator (e.g. issuing an
 *     API key *for* a user); it is never overwritten. These tools carry their
 *     own `adminToken` gate.
 *   - `public`: callable without authentication (e.g. `ping`).
 */
export type ToolAuthMode = 'identity' | 'admin' | 'public';

/**
 * Verified per-call actor facts derived from the dispatch's auth decision, passed
 * as an OPTIONAL second argument to `Tool.handler`. This is the single canonical
 * actor shape shared across consumers (WP2 audit, WP4 provenance, WP5 per-agent
 * attribution — see GAPS A30); do not fork a divergent one.
 *
 * It is built from the transport's verified auth info, never from the tool input,
 * so a handler can attribute a mutation to the real principal. All fields are
 * optional: an unauthenticated/legacy call carries none of them.
 */
export interface ToolCallContext {
  /** The verified tenant/principal the call acts as (post-delegation). */
  actorUserId?: string;
  /** The calling API key's id, when the request was API-key authenticated. */
  apiKeyId?: string;
  /** The principal's granted scopes. */
  scopes?: string[];
  /** True when an admin-scoped key delegated to another tenant's userId. */
  delegated?: boolean;
}

/**
 * Tool definition interface
 */
export interface Tool {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  /**
   * Execute the tool. The optional second argument carries verified actor facts
   * ({@link ToolCallContext}) for handlers that audit/attribute the call; it is
   * backward-compatible — existing one-arg handlers keep working unchanged.
   */
  handler: (input: unknown, context?: ToolCallContext) => Promise<unknown>;
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
  /**
   * Opt this identity-mode tool into *delegation*: when set, a principal holding
   * the `admin` scope may explicitly pass another tenant's `userId` and have it
   * honoured instead of being pinned to its own tenant (the multi-tenant
   * operator-console case; delegated calls are audited). Defaults to false, so
   * identity tools pin every caller — admins included — to the verified tenant
   * unless they opt in. Ignored for `admin`/`public` tools. Set true only on
   * tools that genuinely need cross-tenant operation (e.g. the memory data tools
   * `recall`/`update_memory`/`delete_memory`); leave destructive
   * account/credential tools pinned so an admin key cannot act on other tenants'
   * credentials by accident.
   */
  delegable?: boolean;
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

/**
 * Whether a tool's input schema declares a `userId` we can safely inject.
 *
 * SECURITY: identity-tool userId injection (the tenant boundary) depends on
 * this returning true for every identity tool that carries a `userId`. It is
 * intentionally introspective, and that is a latent trap — a schema built with
 * `.transform()`/`.pipe()`, or `.refine()` on a Zod build where that yields a
 * `ZodEffects` instead of a `ZodObject`, is NOT `instanceof z.ZodObject`, so
 * injection would silently skip and a client-supplied `userId` would flow
 * through unchecked. Today the `recall` tool uses `.strict().refine(...)` and
 * Zod v4 keeps that a `ZodObject`, so it is covered. The guard test
 * `injects userId into a .refine()-wrapped identity schema` in
 * dispatch-auth.spec.ts pins that behaviour so a Zod downgrade or a new
 * effects-wrapped tool fails CI here instead of leaking cross-tenant.
 */
function schemaAcceptsUserId(schema: z.ZodSchema): boolean {
  return (
    schema instanceof z.ZodObject && Object.prototype.hasOwnProperty.call(schema.shape, 'userId')
  );
}

/** Outcome of {@link resolveActingUserId} for an identity-mode tool call. */
export interface ActingUserDecision {
  /** The tenant the tool call will act on. */
  effectiveUserId: string;
  /** True when an admin-scoped principal explicitly targeted another tenant. */
  delegated: boolean;
}

/**
 * Decide which tenant an identity-mode tool acts on. The verified identity
 * always wins for ordinary principals — the tenant boundary is the token, not
 * the request body. The one exception is *delegation*, which requires BOTH
 * conditions: the tool opts in (`toolAllowsDelegation`, from `Tool.delegable`)
 * AND the principal holds the `admin` scope. Such a principal may then
 * explicitly name another tenant in `userId` and have it honoured (the
 * multi-tenant operator-console case). Everyone else — non-admins, and admins
 * calling a non-delegable tool — is pinned back to their own tenant, preserving
 * the pre-existing overwrite behavior. Keeping both gates here means the full
 * cross-tenant decision lives in one auditable, unit-tested function.
 */
export function resolveActingUserId(
  verifiedUserId: string,
  requestedUserId: unknown,
  scopes: readonly string[],
  toolAllowsDelegation: boolean
): ActingUserDecision {
  // Normalise: use the trimmed value so a whitespace-only id counts as absent
  // and a padded id ("  x  ") is compared/acted on as its real value ("x")
  // rather than being treated as a distinct tenant that then fails validation.
  const requested =
    typeof requestedUserId === 'string' && requestedUserId.trim().length > 0
      ? requestedUserId.trim()
      : undefined;
  if (
    toolAllowsDelegation &&
    requested &&
    requested !== verifiedUserId &&
    scopes.includes(ADMIN_SCOPE)
  ) {
    return { effectiveUserId: requested, delegated: true };
  }
  return { effectiveUserId: verifiedUserId, delegated: false };
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
      // token, not the request body. The one exception is a tool that opts into
      // delegation (`delegable`) called by an admin-scoped principal: it may act
      // on behalf of another tenant (e.g. the multi-tenant operator console).
      // Delegated calls are audited.
      let args: unknown = request.params.arguments ?? {};
      const rawApiKeyId = extra?.authInfo?.extra?.apiKeyId;
      const apiKeyId = typeof rawApiKeyId === 'string' ? rawApiKeyId : undefined;
      let delegated = false;
      let actorUserId = userId;
      if (mode === 'identity' && userId && schemaAcceptsUserId(tool.inputSchema)) {
        const record = args as Record<string, unknown>;
        const decision = resolveActingUserId(
          userId,
          record.userId,
          authenticatedScopes(extra),
          tool.delegable === true
        );
        delegated = decision.delegated;
        actorUserId = decision.effectiveUserId;
        if (decision.delegated) {
          logger.log(
            `delegated_user_id tool=${toolName} actor=${userId} target=${decision.effectiveUserId}` +
              (apiKeyId ? ` apiKeyId=${apiKeyId}` : '')
          );
        }
        args = { ...record, userId: decision.effectiveUserId };
      }

      // Validate input with Zod
      const validatedInput = tool.inputSchema.parse(args);

      // Verified actor facts for handlers that audit/attribute the call (WP2 T5,
      // GAPS A30). Built from the transport's auth info + the delegation decision,
      // never from the tool input. `actorUserId` reflects the post-delegation
      // tenant the call acts on.
      const context: ToolCallContext = {
        actorUserId,
        apiKeyId,
        scopes: authenticatedScopes(extra),
        delegated,
      };

      // Execute tool handler
      const result = await tool.handler(validatedInput, context);

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
