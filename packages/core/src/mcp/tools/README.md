---
title: MCP Tools
description: Tool development guide for the ENGRAM MCP registry
---

## Overview

MCP tools are registered in `packages/core` and exposed by the ENGRAM MCP
server. Each tool has a name, description, Zod input schema, and async handler.

## Available Tools

| Tool   | Purpose                                |
| ------ | -------------------------------------- |
| `ping` | Test connectivity to the ENGRAM server |

`ping` accepts an empty object and returns a status with a timestamp.

```json
{
  "status": "pong",
  "timestamp": "2025-10-03T09:30:00.000Z"
}
```

## Tool Shape

```typescript
import { z } from 'zod';

export const myToolInputSchema = z
  .object({
    message: z.string().min(1).max(1000),
  })
  .strict();

export type MyToolInput = z.infer<typeof myToolInputSchema>;

export interface MyToolOutput {
  result: string;
}

export async function myToolHandler(input: MyToolInput): Promise<MyToolOutput> {
  return { result: input.message };
}

export const myTool = {
  name: 'my_tool',
  description: 'Return the provided message',
  inputSchema: myToolInputSchema,
  handler: myToolHandler,
};
```

## Add a Tool

1. Create a tool file in `packages/core/src/mcp/tools`.
2. Define a strict Zod input schema.
3. Export the handler and tool definition.
4. Register the tool in `packages/core/src/mcp/tools/index.ts`.
5. Add focused tests beside the tool implementation.

## Validation Rules

- Use `.strict()` on object schemas.
- Reject invalid inputs before handler logic runs.
- Keep handler outputs JSON-serializable.
- Avoid side effects in tests unless the tool is explicitly integration-tested.
- Return clear errors that the registry can format as MCP error responses.

## Related Docs

- MCP server: [../../../../../apps/mcp-server/README.md](../../../../../apps/mcp-server/README.md)
- Core package manifest: [../../../package.json](../../../package.json)
