import { PgVectorHealthIndicator } from './pgvector.health';

describe('PgVectorHealthIndicator', () => {
  it('reports healthy and not applicable when the store has no healthCheck', async () => {
    const indicator = new PgVectorHealthIndicator({
      backend: 'pgvector',
    } as never);

    const result = await indicator.isHealthy('pgvector');
    expect(result.pgvector?.status).toBe('up');
    expect(result.pgvector?.applicable).toBe(false);
  });

  it('reports healthy when the pgvector store probe succeeds', async () => {
    const store = {
      backend: 'pgvector',
      healthCheck: jest
        .fn()
        .mockResolvedValue({ ok: true, extension: true, column: true }),
    };
    const indicator = new PgVectorHealthIndicator(store as never);

    const result = await indicator.isHealthy('pgvector');
    expect(result.pgvector?.status).toBe('up');
    expect(store.healthCheck).toHaveBeenCalledTimes(1);
  });

  it('throws when the pgvector store probe fails', async () => {
    const store = {
      backend: 'pgvector',
      healthCheck: jest
        .fn()
        .mockResolvedValue({ ok: false, extension: false, column: true }),
    };
    const indicator = new PgVectorHealthIndicator(store as never);

    await expect(indicator.isHealthy('pgvector')).rejects.toThrow(
      /pgvector check failed/,
    );
  });

  it('reports healthy and not applicable when no store is injected', async () => {
    const indicator = new PgVectorHealthIndicator(undefined);
    const result = await indicator.isHealthy('pgvector');
    expect(result.pgvector?.status).toBe('up');
  });
});
