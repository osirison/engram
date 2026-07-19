import { describe, it, expect } from 'vitest';
import { resolveCapabilities, DeploymentProfile } from '@engram/config';
import { MemoryStmModule, STM_PROVIDER } from './memory-stm.module';
import { PostgresStmAdapter } from './adapters/postgres-stm.adapter';

type ProviderBinding = { provide: unknown; useExisting?: unknown };

function providerBindings(profile: DeploymentProfile): ProviderBinding[] {
  const dynamicModule = MemoryStmModule.forRoot(resolveCapabilities(profile));
  return (dynamicModule.providers ?? []) as ProviderBinding[];
}

describe('MemoryStmModule.forRoot', () => {
  it.each([DeploymentProfile.LITE, DeploymentProfile.STANDARD])(
    'wires the Postgres STM adapter for profile %s',
    (profile) => {
      const bindings = providerBindings(profile);

      expect(bindings).toContain(PostgresStmAdapter);
      expect(bindings.find((p) => p.provide === STM_PROVIDER)?.useExisting).toBe(
        PostgresStmAdapter
      );
    }
  );
});
