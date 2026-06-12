---
title: MCP Tools
description: Tool development guide for the ENGRAM MCP registry
---

## Overview

MCP tools are registered in `packages/core` and exposed by the ENGRAM MCP
server. Each tool has a name, description, Zod input schema, and async handler.

## Available Tools

### Built-in (core package)

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

### Memory tools (mcp-server app)

Memory tools are registered by the `mcp-server` app via `registerAdditionalTools`. See
[`apps/mcp-server/src/memory/memory.controller.ts`](../../../../../apps/mcp-server/src/memory/memory.controller.ts)
for the full handler implementations.

| Tool                     | Purpose                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `create_memory`          | Create a short-term or long-term memory                        |
| `get_memory`             | Retrieve a memory by ID                                        |
| `list_memories`          | List memories with pagination, tag, and text-search filters    |
| `update_memory`          | Update content, metadata, or tags on an existing memory        |
| `delete_memory`          | Delete a memory by ID                                          |
| `promote_memory`         | Promote a short-term memory to long-term storage               |
| `recall`                 | Semantic recall — find relevant long-term memories for a query |
| `reindex_memories`       | Rebuild the vector store from Postgres (admin/maintenance)     |
| `queue_reindex_memories` | Queue an asynchronous reindex job                              |
| `get_reindex_status`     | Poll a queued reindex job's progress by job ID                 |
| `cancel_reindex_job`     | Cancel a queued or running reindex job                         |
| `retry_reindex_job`      | Retry a failed or cancelled reindex job from its last cursor   |

#### `recall` — semantic search

Embeds a natural-language query, runs a kNN search over the tenant-scoped vector index,
and returns ranked long-term memories with similarity scores.

**Input schema**

| Field  | Type            | Required | Default | Description                                       |
| ------ | --------------- | -------- | ------- | ------------------------------------------------- |
| userId | string (cuid/cuid2) | yes      |         | Tenant identifier — search is scoped to this user |
| query  | string (1–2048) | yes      |         | Natural-language query to embed and search        |
| limit  | integer (1–50)  | no       | 10      | Maximum number of results to return               |
| scope  | string (≤256)   | no       |         | Optional namespace filter (agent/session/project) |
| tags   | string[] (≤50)  | no       |         | Filter by tags — pgvector requires all tags present (AND); Qdrant matches any tag (OR) |

**Example response**

```json
{
  "query": "what did I learn about embeddings?",
  "count": 2,
  "results": [
    {
      "score": 0.94,
      "memory": {
        "id": "clm...",
        "userId": "clm...",
        "content": "Embeddings represent text as dense vectors ...",
        "tags": ["ml", "embeddings"],
        "type": "long-term",
        "createdAt": "2026-06-01T10:00:00.000Z"
      }
    }
  ]
}
```

Returns an empty `results` array when the vector store is not configured, the embeddings
service is unavailable, or no memories match the query.

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
