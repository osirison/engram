import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { QdrantService } from '@engram/vector-store';

@Injectable()
export class QdrantHealthIndicator extends HealthIndicator {
  constructor(private readonly qdrantService: QdrantService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const isHealthy = await this.qdrantService.healthCheck();
    const result = this.getStatus(key, isHealthy);

    if (isHealthy) {
      return result;
    }

    throw new HealthCheckError('Qdrant check failed', result);
  }
}
