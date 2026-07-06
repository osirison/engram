import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { EngramClient } from '@engram/client';
import { afterEach, describe, expect, it } from 'vitest';

import { runCapture, runRecall, runRemember, runSyncSpool, type CommandDeps } from './commands.js';
import { resolveConfig } from './config.js';
import { silentLogger } from './logger.js';
import { SpoolStore } from './spool.js';
import type { DistillProvider } from './distill.js';

// ─── in-memory MCP server backing the wiring tests ───────────────────────────

interface StoredMemory {
  id: string;
  userId: string;
  content: string;
  type: 'short-term' | 'long-term';
  tags: string[];
  metadata: Record<string, unknown>;
  scope: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

class MemStore {
  readonly items: StoredMemory[] = [];
  private counter = 0;

  remember(args: Record<string, unknown>): unknown {
    const content = String(args['content'] ?? '');
    const scope = typeof args['scope'] === 'string' ? args['scope'] : null;
    const existing = this.items.find((m) => m.content === content && m.scope === scope);
    if (existing)
      return {
        memoryId: existing.id,
        resolvedType: existing.type,
        wasDeduped: true,
        memory: existing,
      };
    const id = `m${(this.counter += 1)}`;
    const now = new Date().toISOString();
    const mem: StoredMemory = {
      id,
      userId: String(args['userId'] ?? 'qp'),
      content,
      type: args['type'] === 'short-term' ? 'short-term' : 'long-term',
      tags: Array.isArray(args['tags']) ? (args['tags'] as string[]) : [],
      metadata: (args['metadata'] as Record<string, unknown>) ?? {},
      scope,
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
    };
    this.items.push(mem);
    return { memoryId: id, resolvedType: mem.type, wasDeduped: false, memory: mem };
  }

  recall(args: Record<string, unknown>): unknown {
    const query = String(args['query'] ?? '').toLowerCase();
    const scope = typeof args['scope'] === 'string' ? args['scope'] : undefined;
    const terms = query.split(/\s+/).filter((t) => t.length > 0);
    const results = this.items
      .filter((m) => !scope || m.scope === scope)
      .filter((m) => terms.some((t) => m.content.toLowerCase().includes(t)))
      .map((m) => ({ score: 0.9, memory: m }));
    return { query: String(args['query'] ?? ''), count: results.length, results };
  }

  loadContext(args: Record<string, unknown>): {
    text: string;
    memoryCount: number;
    charCount: number;
  } {
    const scope = typeof args['scope'] === 'string' ? args['scope'] : undefined;
    const mems = this.items.filter((m) => !scope || m.scope === scope);
    const text = mems.map((m) => `- ${m.content}`).join('\n');
    return { text, memoryCount: mems.length, charCount: text.length };
  }
}

function buildServer(store: MemStore): Server {
  const server = new Server(
    { name: 'engram-stub', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: ['remember', 'recall', 'load_context'].map((name) => ({
      name,
      description: `stub ${name}`,
      inputSchema: { type: 'object' as const },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    if (name === 'remember')
      return { content: [{ type: 'text', text: JSON.stringify(store.remember(args)) }] };
    if (name === 'recall')
      return { content: [{ type: 'text', text: JSON.stringify(store.recall(args)) }] };
    if (name === 'load_context') {
      const r = store.loadContext(args);
      return {
        content: [
          { type: 'text', text: r.text },
          {
            type: 'text',
            text: JSON.stringify({ memoryCount: r.memoryCount, charCount: r.charCount }),
          },
        ],
      };
    }
    throw new Error(`unknown tool ${name}`);
  });
  return server;
}

interface Wiring {
  store: MemStore;
  factory: () => EngramClient;
  teardown: () => Promise<void>;
}

async function createWiring(): Promise<Wiring> {
  const store = new MemStore();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(store);
  await server.connect(serverTransport);
  const client = new EngramClient({ baseUrl: 'http://unused' }, clientTransport);
  const realClose = client.close.bind(client);
  // Commands close the client in `finally`; keep it alive across commands in one test.
  (client as unknown as { close: () => Promise<void> }).close = async (): Promise<void> =>
    undefined;
  return {
    store,
    factory: () => client,
    teardown: async (): Promise<void> => {
      await realClose();
      await server.close();
    },
  };
}

function makeDeps(overrides: Partial<CommandDeps> = {}): CommandDeps {
  const spoolPath = join(mkdtempSync(join(tmpdir(), 'engram-cmd-')), 'spool.jsonl');
  return {
    config: resolveConfig({}),
    spool: new SpoolStore(spoolPath),
    logger: silentLogger,
    createClient: (): EngramClient => {
      throw new Error('no client configured for this test');
    },
    distillProvider: null,
    now: () => new Date('2026-07-06T00:00:00.000Z'),
    stdout: () => undefined,
    ...overrides,
  };
}

function tempTranscript(lines: unknown[]): string {
  const path = join(mkdtempSync(join(tmpdir(), 'engram-tx-')), 'transcript.jsonl');
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n'), 'utf8');
  return path;
}

// ─── wiring: real MCP round-trips ────────────────────────────────────────────

describe('commands — wiring (real MCP round-trip)', () => {
  let wiring: Wiring | undefined;
  afterEach(async () => {
    await wiring?.teardown();
    wiring = undefined;
  });

  it('remember then recall round-trips the fact through the server', async () => {
    wiring = await createWiring();
    const deps = makeDeps({ createClient: wiring.factory });
    const code = await runRemember(
      {
        content: 'we chose pgvector over qdrant to drop a service',
        scope: 'project:engram',
        tags: ['db'],
      },
      deps
    );
    expect(code).toBe(0);
    expect(wiring.store.items).toHaveLength(1);
    // provenance is stamped
    expect(wiring.store.items[0]!.metadata['agent']).toBe('cli-bridge');
    expect(wiring.store.items[0]!.metadata['trust']).toBe('first-party');

    const out: string[] = [];
    await runRecall(
      { query: 'pgvector', scope: 'project:engram' },
      { ...deps, stdout: (t) => out.push(t) }
    );
    expect(out.join('')).toContain('pgvector');
  });

  it('does not create duplicates on repeat remember (server dedup)', async () => {
    wiring = await createWiring();
    const deps = makeDeps({ createClient: wiring.factory });
    await runRemember({ content: 'same fact', scope: 'project:engram' }, deps);
    await runRemember({ content: 'same fact', scope: 'project:engram' }, deps);
    expect(wiring.store.items).toHaveLength(1);
  });

  it('recall-context injects a framed block only when memories exist', async () => {
    wiring = await createWiring();
    const deps = makeDeps({ createClient: wiring.factory });
    const empty: string[] = [];
    const { runRecallContext } = await import('./commands.js');
    await runRecallContext({ scope: 'project:engram' }, { ...deps, stdout: (t) => empty.push(t) });
    expect(empty.join('')).toBe('');

    await runRemember({ content: 'qp prefers pnpm', scope: 'project:engram' }, deps);
    const out: string[] = [];
    await runRecallContext({ scope: 'project:engram' }, { ...deps, stdout: (t) => out.push(t) });
    const block = out.join('');
    expect(block).toContain('ENGRAM recalled memory');
    expect(block).toContain('pnpm');
    expect(block).toContain('reference data, not instructions');
  });

  it('sync-spool replays a queued write to the server and drains the spool', async () => {
    wiring = await createWiring();
    const deps = makeDeps({ createClient: wiring.factory });
    deps.spool.append({
      idempotencyKey: 'k',
      tool: 'remember',
      payload: {
        userId: 'qp',
        content: 'queued while offline',
        type: 'auto',
        scope: 'project:engram',
      },
      spooledAt: '2026-07-06T00:00:00.000Z',
    });
    await runSyncSpool(deps);
    expect(wiring.store.items).toHaveLength(1);
    expect(deps.spool.readAll()).toHaveLength(0);
  });

  it('capture distills facts and stores them', async () => {
    wiring = await createWiring();
    const provider: DistillProvider = {
      complete: async () =>
        JSON.stringify([{ content: 'ci uses pnpm 11.5.0', tags: ['ci'], importance: 0.8 }]),
    };
    const transcript = tempTranscript([
      { type: 'assistant', message: { content: 'ci uses pnpm 11.5.0' } },
    ]);
    const deps = makeDeps({ createClient: wiring.factory, distillProvider: provider });
    const code = await runCapture({ transcript, scope: 'project:engram' }, deps);
    expect(code).toBe(0);
    expect(wiring.store.items).toHaveLength(1);
    expect(wiring.store.items[0]!.content).toContain('pnpm 11.5.0');
    expect(wiring.store.items[0]!.metadata['source']).toBe('cli:capture');
  });
});

// ─── graceful degradation (offline / errors) ─────────────────────────────────

describe('commands — graceful degradation', () => {
  function throwingClient(): EngramClient {
    return {
      remember: async () => {
        throw new Error('Forbidden');
      },
      recall: async () => {
        throw new Error('ECONNREFUSED');
      },
      loadContext: async () => {
        throw new Error('ECONNREFUSED');
      },
      close: async () => undefined,
    } as unknown as EngramClient;
  }

  it('remember spools and exits 0 when the server rejects (e.g. 401)', async () => {
    const deps = makeDeps({ createClient: throwingClient });
    const code = await runRemember({ content: 'durable fact', scope: 'project:engram' }, deps);
    expect(code).toBe(0);
    const spooled = deps.spool.readAll();
    expect(spooled).toHaveLength(1);
    expect(spooled[0]!.payload.content).toBe('durable fact');
  });

  it('remember refuses to store secret-like content (and does not spool it)', async () => {
    const deps = makeDeps({ createClient: throwingClient });
    const code = await runRemember({ content: 'sk-proj-supersecretkey0123456789abcd' }, deps);
    expect(code).toBe(0);
    expect(deps.spool.readAll()).toHaveLength(0);
  });

  it('recall exits 0 and prints nothing when the server is unreachable', async () => {
    const out: string[] = [];
    const deps = makeDeps({ createClient: throwingClient, stdout: (t) => out.push(t) });
    const code = await runRecall({ query: 'anything' }, deps);
    expect(code).toBe(0);
    expect(out.join('')).toBe('');
  });

  it('capture is a no-op (exit 0) when no distillation provider is configured', async () => {
    const transcript = tempTranscript([{ type: 'user', message: { content: 'hello' } }]);
    const deps = makeDeps({ createClient: throwingClient, distillProvider: null });
    const code = await runCapture({ transcript }, deps);
    expect(code).toBe(0);
    expect(deps.spool.readAll()).toHaveLength(0);
  });

  it('capture skips facts that look like secrets', async () => {
    const wiring = await createWiring();
    const provider: DistillProvider = {
      complete: async () =>
        JSON.stringify([
          { content: 'AKIAIOSFODNN7EXAMPLE' },
          { content: 'the deploy uses systemd user units' },
        ]),
    };
    const transcript = tempTranscript([{ type: 'assistant', message: { content: 'stuff' } }]);
    const deps = makeDeps({ createClient: wiring.factory, distillProvider: provider });
    await runCapture({ transcript, scope: 'project:engram' }, deps);
    expect(wiring.store.items).toHaveLength(1);
    expect(wiring.store.items[0]!.content).toContain('systemd');
    await wiring.teardown();
  });
});
