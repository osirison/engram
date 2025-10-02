import { Controller, Get } from '@nestjs/common';
import { QdrantService } from '@engram/vector-store';

@Controller('health')
export class HealthController {
  constructor(private readonly qdrantService: QdrantService) {}

  @Get()
  async check(): Promise<{
    status: string;
    qdrant: boolean;
  }> {
    const qdrantHealthy = await this.qdrantService.healthCheck();

    return {
      status: qdrantHealthy ? 'healthy' : 'degraded',
      qdrant: qdrantHealthy,
    };
  }

  @Get('qdrant')
  async qdrantHealth(): Promise<{ healthy: boolean }> {
    const healthy = await this.qdrantService.healthCheck();
    return { healthy };
  }
}
