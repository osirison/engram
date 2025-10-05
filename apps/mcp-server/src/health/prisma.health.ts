import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { PrismaService } from '@engram/database';

@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
  constructor(private readonly prismaService: PrismaService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      // Use $connect/$disconnect for simple health check to avoid template tag linting issues
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      await this.prismaService.$connect();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      await this.prismaService.$disconnect();
      return this.getStatus(key, true);
    } catch {
      throw new HealthCheckError(
        'Prisma check failed',
        this.getStatus(key, false),
      );
    }
  }
}
