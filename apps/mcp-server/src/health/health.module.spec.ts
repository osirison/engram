import { QdrantModule, VectorStoreModule } from '@engram/vector-store';
import { resolveCapabilities, DeploymentProfile } from '@engram/config';
import { HealthModule } from './health.module';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';
import { QdrantHealthIndicator } from './qdrant.health';
import { PgVectorHealthIndicator } from './pgvector.health';
import { MemoryStoreHealthIndicator } from './memory-store.health';

/**
 * Structural wiring tests for {@link HealthModule.forRoot}.
 *
 * These inspect the {@link DynamicModule} the factory returns rather than
 * compiling the Nest graph, so they assert which indicators a profile/backend
 * combination provides without standing up Postgres/Qdrant/Redis. This is the
 * regression guard for #187: pgvector wiring must follow the active backend,
 * not `requiresQdrant`.
 */
describe('HealthModule.forRoot wiring', () => {
  const ORIGINAL_BACKEND = process.env.VECTOR_BACKEND;

  afterEach(() => {
    if (ORIGINAL_BACKEND === undefined) {
      delete process.env.VECTOR_BACKEND;
    } else {
      process.env.VECTOR_BACKEND = ORIGINAL_BACKEND;
    }
  });

  function build(
    profile: DeploymentProfile,
    backend?: string,
  ): { providers: unknown[]; imports: unknown[] } {
    if (backend === undefined) {
      delete process.env.VECTOR_BACKEND;
    } else {
      process.env.VECTOR_BACKEND = backend;
    }
    const dynamic = HealthModule.forRoot(resolveCapabilities(profile));
    return {
      providers: (dynamic.providers ?? []) as unknown[],
      imports: (dynamic.imports ?? []) as unknown[],
    };
  }

  it('MEMORY wires neither vector backend', () => {
    const { providers, imports } = build(DeploymentProfile.MEMORY, 'pgvector');
    expect(providers).toContain(MemoryStoreHealthIndicator);
    expect(providers).not.toContain(PrismaHealthIndicator);
    expect(providers).not.toContain(QdrantHealthIndicator);
    expect(providers).not.toContain(PgVectorHealthIndicator);
    expect(imports).not.toContain(QdrantModule);
    expect(imports).not.toContain(VectorStoreModule);
  });

  it('LITE + pgvector provides the pgvector indicator and store, but not Qdrant', () => {
    const { providers, imports } = build(DeploymentProfile.LITE, 'pgvector');
    expect(providers).toContain(PrismaHealthIndicator);
    expect(providers).toContain(PgVectorHealthIndicator);
    expect(providers).not.toContain(QdrantHealthIndicator);
    expect(providers).not.toContain(RedisHealthIndicator);
    expect(imports).toContain(VectorStoreModule);
    expect(imports).not.toContain(QdrantModule);
  });

  it('LITE without pgvector wires no vector indicator at all', () => {
    const { providers, imports } = build(DeploymentProfile.LITE, 'qdrant');
    expect(providers).toContain(PrismaHealthIndicator);
    expect(providers).not.toContain(PgVectorHealthIndicator);
    expect(providers).not.toContain(QdrantHealthIndicator);
    expect(imports).not.toContain(VectorStoreModule);
    expect(imports).not.toContain(QdrantModule);
  });

  it('ENTERPRISE + qdrant provides only the Qdrant indicator', () => {
    const { providers, imports } = build(
      DeploymentProfile.ENTERPRISE,
      'qdrant',
    );
    expect(providers).toContain(QdrantHealthIndicator);
    expect(providers).not.toContain(PgVectorHealthIndicator);
    expect(imports).toContain(QdrantModule);
    expect(imports).not.toContain(VectorStoreModule);
  });

  it('ENTERPRISE + pgvector provides both indicators (no regression)', () => {
    const { providers, imports } = build(
      DeploymentProfile.ENTERPRISE,
      'pgvector',
    );
    expect(providers).toContain(QdrantHealthIndicator);
    expect(providers).toContain(PgVectorHealthIndicator);
    expect(imports).toContain(QdrantModule);
    expect(imports).toContain(VectorStoreModule);
  });
});
