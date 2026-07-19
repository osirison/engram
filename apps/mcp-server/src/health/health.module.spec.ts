import { VectorStoreModule } from '@engram/vector-store';
import { resolveCapabilities, DeploymentProfile } from '@engram/config';
import { HealthModule } from './health.module';
import { PrismaHealthIndicator } from './prisma.health';
import { PgVectorHealthIndicator } from './pgvector.health';
import { MemoryStoreHealthIndicator } from './memory-store.health';

/**
 * Structural wiring tests for {@link HealthModule.forRoot}.
 *
 * These inspect the {@link DynamicModule} the factory returns rather than
 * compiling the Nest graph. Both profiles are Postgres-backed, so both wire
 * the Prisma and pgvector indicators.
 */
describe('HealthModule.forRoot wiring', () => {
  function build(profile: DeploymentProfile): {
    providers: unknown[];
    imports: unknown[];
  } {
    const dynamic = HealthModule.forRoot(resolveCapabilities(profile));
    return {
      providers: (dynamic.providers ?? []) as unknown[],
      imports: (dynamic.imports ?? []) as unknown[],
    };
  }

  it.each([DeploymentProfile.LITE, DeploymentProfile.STANDARD])(
    'profile %s wires the process, Prisma, and pgvector indicators',
    (profile) => {
      const { providers, imports } = build(profile);
      expect(providers).toContain(MemoryStoreHealthIndicator);
      expect(providers).toContain(PrismaHealthIndicator);
      expect(providers).toContain(PgVectorHealthIndicator);
      expect(imports).toContain(VectorStoreModule);
    },
  );
});
