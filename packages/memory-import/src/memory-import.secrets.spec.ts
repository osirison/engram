// Wiring-level G2-T2 acceptance: full imports over real adapters + fixtures
// whose secrets live ONLY in YAML frontmatter (and the title derived from it)
// — the fact bodies are clean. Proves the persisted metadata (buildMetadata's
// `frontmatter` + `title`) never carries a raw secret under any policy.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { MemoryImportService, type ImportRunInput } from './memory-import.service.js';
import { ImportSecretPolicyError, SecretScanner } from './secrets/secret-scanner.js';
import { buildAdapterRegistry } from './adapters/registry.js';

const CURSOR_ROOT = fileURLToPath(
  new URL('./adapters/__fixtures__/cursor-secrets', import.meta.url)
);
const COPILOT_ROOT = fileURLToPath(
  new URL('./adapters/__fixtures__/copilot-secrets', import.meta.url)
);

/** Raw secrets planted in the fixtures — must never appear in a persisted row. */
const AWS_SECRET = 'AKIAIOSFODNN7EXAMPLE';
const GH_SECRET = 'ghp_1234567890abcdefghijklmnopqrstuvwxyzAB';

function makeLedger() {
  return {
    find: vi.fn(async () => null),
    findByContentHash: vi.fn(async () => [] as unknown[]),
    upsert: vi.fn(async (e: Record<string, unknown>) => ({ ...e })),
  };
}

function makeLtm() {
  let n = 0;
  return {
    create: vi.fn(async (input: { content: string }) => ({
      id: `mem-${++n}`,
      content: input.content,
      metadata: {},
    })),
    update: vi.fn(async (_u: string, id: string) => ({ id, content: '', metadata: {} })),
  };
}

function makeResolver() {
  return {
    resolveBatch: vi.fn(async () => ({ resolved: 0, deferred: 0, total: 0 })),
    resolveDeferred: vi.fn(async () => 0),
  };
}

type CreateArg = { content: string; tags: string[]; metadata: Record<string, unknown> };

describe('import wiring — secrets in fixture frontmatter/title (G2-T2)', () => {
  let ltm: ReturnType<typeof makeLtm>;
  let ledger: ReturnType<typeof makeLedger>;
  let resolver: ReturnType<typeof makeResolver>;
  let service: MemoryImportService;

  beforeEach(() => {
    ltm = makeLtm();
    ledger = makeLedger();
    resolver = makeResolver();
    service = new MemoryImportService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ltm as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ledger as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolver as any,
      new SecretScanner(),
      buildAdapterRegistry()
    );
  });

  function createdArg(index = 0): CreateArg {
    return ltm.create.mock.calls[index]?.[0] as unknown as CreateArg;
  }

  const cursorInput: ImportRunInput = { source: 'cursor', path: CURSOR_ROOT, userId: 'qp' };
  const copilotInput: ImportRunInput = { source: 'copilot', path: COPILOT_ROOT, userId: 'qp' };

  it('cursor .mdc, redact: stored frontmatter is redacted in place, shape intact', async () => {
    const summary = await service.run(cursorInput); // default policy: redact
    expect(summary.created).toBe(1);

    const created = createdArg();
    expect(JSON.stringify(created)).not.toContain(AWS_SECRET);
    expect(created.metadata['frontmatter']).toEqual({
      description: 'Deploy uses key [REDACTED] for the registry',
      globs: ['deploy/**'],
      alwaysApply: false,
      retries: 3,
    });
    expect(summary.secrets).toEqual([{ path: '.cursor/rules/deploy.mdc', patterns: ['aws-key'] }]);
  });

  it('copilot .instructions.md, redact: stored title + frontmatter carry no raw secret', async () => {
    const summary = await service.run(copilotInput);
    expect(summary.created).toBe(1);

    const created = createdArg();
    expect(JSON.stringify(created)).not.toContain(GH_SECRET);
    expect(created.metadata['title']).toBe('rotate [REDACTED] monthly');
    expect(created.metadata['frontmatter']).toEqual({
      description: 'Deploy rotation notes',
      name: 'rotate [REDACTED] monthly',
      applyTo: 'deploy/**',
    });
    expect(summary.secrets).toEqual([
      {
        path: '.github/instructions/deploy.instructions.md',
        patterns: ['github-token'],
      },
    ]);
  });

  it('flag: frontmatter-only hit embedding-excludes the row and tags has-secret', async () => {
    await service.run({ ...cursorInput, secretsPolicy: 'flag' });
    const created = createdArg();
    expect(JSON.stringify(created)).not.toContain(AWS_SECRET);
    expect(created.metadata['embeddingExcluded']).toBe(true);
    expect(created.tags).toContain('has-secret');
  });

  it('skip: a frontmatter-only hit drops the whole fact', async () => {
    const summary = await service.run({ ...copilotInput, secretsPolicy: 'skip' });
    expect(summary.secretsSkipped).toBe(1);
    expect(summary.created).toBe(0);
    expect(ltm.create).not.toHaveBeenCalled();
    expect(ledger.upsert).not.toHaveBeenCalled();
  });

  it('fail: a frontmatter hit aborts the import, naming the surface', async () => {
    const promise = service.run({ ...cursorInput, secretsPolicy: 'fail' });
    await expect(promise).rejects.toBeInstanceOf(ImportSecretPolicyError);
    await expect(promise).rejects.toThrow(/in frontmatter/);
    expect(ltm.create).not.toHaveBeenCalled();
  });

  it('dry run reports identically to the real run and writes nothing', async () => {
    const dry = await service.run({ ...copilotInput, dryRun: true, secretsPolicy: 'skip' });
    expect(ltm.create).not.toHaveBeenCalled();
    expect(ledger.upsert).not.toHaveBeenCalled();

    const real = await service.run({ ...copilotInput, secretsPolicy: 'skip' });
    expect(dry.parsed).toBe(real.parsed);
    expect(dry.secretsSkipped).toBe(real.secretsSkipped);
    expect(dry.secrets).toEqual(real.secrets);
    expect(dry.embeddingCostEstimate).toEqual(real.embeddingCostEstimate);
  });
});
