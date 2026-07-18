import { describe, it, expect } from 'vitest';
import { resolveCapabilities, DeploymentProfile } from '@engram/config';
import { MemoryStmModule, STM_PROVIDER } from './memory-stm.module';
import { MemoryStmService } from './memory-stm.service';
import { InMemoryStmAdapter } from './adapters/inmemory-stm.adapter';
import { PostgresStmAdapter } from './adapters/postgres-stm.adapter';

type ProviderBinding = { provide: unknown; useExisting?: unknown };

function providerBindings(profile: DeploymentProfile): ProviderBinding[] {
  const dynamicModule = MemoryStmModule.forRoot(resolveCapabilities(profile));
  return (dynamicModule.providers ?? []) as ProviderBinding[];
}

function resolveBinding(bindings: ProviderBinding[], token: unknown): unknown {
  return bindings.find((p) => p.provide === token)?.useExisting;
}

describe('MemoryStmModule.forRoot', () => {
  it.each([DeploymentProfile.LITE, DeploymentProfile.ENTERPRISE])(
    'wires the Postgres STM adapter for database-bearing profile %s',
    (profile) => {
      const bindings = providerBindings(profile);

      expect(bindings).toContain(PostgresStmAdapter);
      expect(resolveBinding(bindings, STM_PROVIDER)).toBe(PostgresStmAdapter);
      // Legacy class-token consumers must keep resolving a compatible impl.
      expect(resolveBinding(bindings, MemoryStmService)).toBe(PostgresStmAdapter);
      expect(bindings).not.toContain(InMemoryStmAdapter);
    }
  );

  it('wires the in-process adapter for the zero-dependency memory profile', () => {
    const bindings = providerBindings(DeploymentProfile.MEMORY);

    expect(bindings).toContain(InMemoryStmAdapter);
    expect(resolveBinding(bindings, STM_PROVIDER)).toBe(InMemoryStmAdapter);
    expect(resolveBinding(bindings, MemoryStmService)).toBe(InMemoryStmAdapter);
    expect(bindings).not.toContain(PostgresStmAdapter);
  });

  it('never registers the Redis-backed MemoryStmService as a concrete provider', () => {
    for (const profile of [
      DeploymentProfile.MEMORY,
      DeploymentProfile.LITE,
      DeploymentProfile.ENTERPRISE,
    ]) {
      const bindings = providerBindings(profile);
      // The class token only ever appears as a useExisting alias.
      expect(bindings).not.toContain(MemoryStmService);
    }
  });
});
