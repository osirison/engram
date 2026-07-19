import { VectorStoreModule } from '@engram/vector-store';
import { resolveCapabilities, DeploymentProfile } from '@engram/config';
import { HealthModule } from './health.module';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';
import { PgVectorHealthIndicator } from './pgvector.health';
import { MemoryStoreHealthIndicator } from './memory-store.health';

/**
 * Structural wiring tests for {@link HealthModule.forRoot}.
 *
 * These inspect the {@link DynamicModule} the factory returns rather than
 * compiling the Nest graph, so they assert which indicators a profile
 * provides without standing up Postgres/Redis. pgvector is the only vector
 * backend: its indicator follows `requiresDatabase`.
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

  it('MEMORY wires no database-backed indicators', () => {
    const { providers, imports } = build(DeploymentProfile.MEMORY);
    expect(providers).toContain(MemoryStoreHealthIndicator);
    expect(providers).not.toContain(PrismaHealthIndicator);
    expect(providers).not.toContain(PgVectorHealthIndicator);
    expect(imports).not.toContain(VectorStoreModule);
  });

  it('LITE provides the Prisma and pgvector indicators, but not Redis', () => {
    const { providers, imports } = build(DeploymentProfile.LITE);
    expect(providers).toContain(PrismaHealthIndicator);
    expect(providers).toContain(PgVectorHealthIndicator);
    expect(providers).not.toContain(RedisHealthIndicator);
    expect(imports).toContain(VectorStoreModule);
  });

  it('ENTERPRISE provides Prisma, Redis, and pgvector indicators', () => {
    const { providers, imports } = build(DeploymentProfile.ENTERPRISE);
    expect(providers).toContain(PrismaHealthIndicator);
    expect(providers).toContain(RedisHealthIndicator);
    expect(providers).toContain(PgVectorHealthIndicator);
    expect(imports).toContain(VectorStoreModule);
  });
});
