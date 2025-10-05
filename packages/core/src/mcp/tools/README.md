# MCP Tools

This directory contains the implementation of MCP (Model Context Protocol) tools for the ENGRAM system.

## Available Tools

### ping

Test connectivity to the ENGRAM server.

**Input:** Empty object `{}`

**Output:**

```json
{
  "status": "pong",
  "timestamp": "2025-10-03T09:30:00.000Z"
}
```

## Tool Architecture

### Tool Definition

Each tool consists of:

1. **Input Schema** - Zod schema defining expected input parameters
2. **Handler Function** - Async function that executes the tool logic
3. **Tool Definition** - Object combining name, description, schema, and handler

### Example Tool Implementation

```typescript
import { z } from 'zod';

// 1. Define input schema with Zod
export const myToolInputSchema = z
  .object({
    message: z.string().min(1).max(1000),
    count: z.number().int().positive().optional(),
  })
  .strict();

// 2. Define output type
export interface MyToolOutput {
  result: string;
  processed: number;
}

// 3. Implement handler function
export async function myToolHandler(
  input: z.infer<typeof myToolInputSchema>
): Promise<MyToolOutput> {
  // Tool logic here
  return {
    result: `Processed: ${input.message}`,
    processed: input.count || 1,
  };
}

// 4. Export tool definition
export const myTool = {
  name: 'my_tool',
  description: 'Description of what my tool does',
  inputSchema: myToolInputSchema,
  handler: myToolHandler,
};
```

### Registering a New Tool

To add a new tool to the system:

1. **Create the tool file** in `packages/core/src/mcp/tools/`:

   ```typescript
   // my-tool.tool.ts
   import { z } from 'zod';

   export const myToolInputSchema = z
     .object({
       // Define input parameters
     })
     .strict();

   export async function myToolHandler(input: unknown): Promise<unknown> {
     // Implement tool logic
   }

   export const myTool = {
     name: 'my_tool',
     description: 'Tool description',
     inputSchema: myToolInputSchema,
     handler: myToolHandler,
   };
   ```

2. **Register in the tools array** in `packages/core/src/mcp/tools/index.ts`:

   ```typescript
   import { myTool } from './my-tool.tool.js';

   const tools: Tool[] = [
     pingTool,
     myTool, // Add your tool here
   ];
   ```

3. **Export from core package** (optional, for external use):

   ```typescript
   // packages/core/src/index.ts
   export { myTool } from './mcp/tools/my-tool.tool';
   ```

4. **Create tests** in `packages/core/src/mcp/tools/my-tool.tool.spec.ts`:

   ```typescript
   import { describe, expect, it } from 'vitest';
   import { myTool, myToolHandler } from './my-tool.tool';

   describe('My Tool', () => {
     it('should handle valid input', async () => {
       const result = await myToolHandler({
         /* test input */
       });
       expect(result).toEqual({
         /* expected output */
       });
     });
   });
   ```

## Tool Execution Flow

1. **Client calls tool** via MCP protocol with `tools/call` request
2. **Registry receives request** and looks up tool by name
3. **Input validation** - Zod schema validates the input parameters
4. **Handler execution** - Tool handler is called with validated input
5. **Response formatting** - Result is formatted as MCP content (text/JSON)
6. **Error handling** - Any errors are caught and returned as error responses

## MCP Protocol Integration

### List Tools Request

When a client requests available tools (`tools/list`), the registry returns:

```json
{
  "tools": [
    {
      "name": "ping",
      "description": "Test connectivity to ENGRAM server",
      "inputSchema": {
        "type": "object",
        "properties": {},
        "required": []
      }
    }
  ]
}
```

### Call Tool Request

When a client calls a tool (`tools/call`):

**Request:**

```json
{
  "method": "tools/call",
  "params": {
    "name": "ping",
    "arguments": {}
  }
}
```

**Response:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"status\":\"pong\",\"timestamp\":\"2025-10-03T09:30:00.000Z\"}"
    }
  ]
}
```

**Error Response:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"error\":\"Unknown tool: invalid_tool\"}"
    }
  ],
  "isError": true
}
```

## Input Validation Best Practices

1. **Use `.strict()`** on schemas to reject unexpected properties
2. **Validate all inputs** with Zod schemas before processing
3. **Define clear types** using `z.infer<typeof schema>` for TypeScript
4. **Set appropriate constraints** (min/max lengths, ranges, patterns)
5. **Document schema requirements** in tool descriptions

## Error Handling

All errors are automatically caught by the tools registry and formatted as MCP error responses. Best practices:

1. **Throw descriptive errors** with clear messages
2. **Use custom error types** for different error conditions
3. **Log errors** for debugging (handled automatically)
4. **Return structured error info** when possible

## Testing Tools

Each tool should have:

1. **Unit tests** for the handler function
2. **Schema validation tests** for input/output
3. **Integration tests** via the tools registry
4. **Edge case tests** for error conditions

Run tests:

```bash
pnpm test --filter @engram/core
```

## Examples

See existing tools for reference:

- `ping.tool.ts` - Simple tool with no input parameters
- `ping.tool.spec.ts` - Example test suite

## Future Enhancements

Planned improvements:

- Advanced JSON Schema conversion for complex Zod schemas
- Tool versioning support
- Tool permission/authentication system
- Streaming responses for long-running tools
- Tool composition and chaining
