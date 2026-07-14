import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { VECTOR_STORE_TOKEN, type VectorStore } from '@engram/vector-store';

/** Narrow structural shape for a vector store that supports a health probe. */
interface HealthCheckableStore {
  healthCheck(): Promise<{
    ok: boolean;
    extension: boolean;
    column: boolean;
    dimensions?: number | null;
  }>;
}

function isHealthCheckable(
  store: VectorStore | undefined,
): store is VectorStore & HealthCheckableStore {
  return (
    store !== undefined &&
    typeof (store as Partial<HealthCheckableStore>).healthCheck === 'function'
  );
}

/**
 * Health indicator for the pgvector backend. Verifies the `vector` extension
 * is installed; the embedding column is runtime-managed (provisioned on the
 * first vector write) and reported informationally. Only meaningful when
 * `VECTOR_BACKEND` is `pgvector`; for other backends the active store has no
 * `healthCheck` method and the indicator reports healthy (not applicable).
 */
@Injectable()
export class PgVectorHealthIndicator extends HealthIndicator {
  constructor(
    @Optional()
    @Inject(VECTOR_STORE_TOKEN)
    private readonly vectorStore?: VectorStore,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    if (!isHealthCheckable(this.vectorStore)) {
      // Not the pgvector backend — nothing to probe.
      return this.getStatus(key, true, { applicable: false });
    }

    const status = await this.vectorStore.healthCheck();
    const result = this.getStatus(key, status.ok, {
      extension: status.extension,
      column: status.column,
      dimensions: status.dimensions ?? null,
    });

    if (status.ok) {
      return result;
    }

    throw new HealthCheckError('pgvector check failed', result);
  }
}
