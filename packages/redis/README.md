# @engram/redis

Redis client package for ENGRAM project with health monitoring support.

## Overview

This package provides a NestJS-ready Redis client using ioredis with built-in health checking capabilities. It includes configuration management and robust connection handling for production use.

## Installation

This package is part of the ENGRAM monorepo and is installed automatically with the workspace.

## Usage

### Import the RedisModule

Import the `RedisModule` in your NestJS module:

```typescript
import { Module } from '@nestjs/common';
import { RedisModule } from '@engram/redis';

@Module({
  imports: [RedisModule],
  // ...
})
export class AppModule {}
```

### Inject RedisService

```typescript
import { Injectable } from '@nestjs/common';
import { RedisService } from '@engram/redis';

@Injectable()
export class MyService {
  constructor(private readonly redisService: RedisService) {}

  async setData(key: string, value: string): Promise<void> {
    await this.redisService.set(key, value);
  }

  async getData(key: string): Promise<string | null> {
    return await this.redisService.get(key);
  }
}
```

## Configuration

The Redis connection is configured via environment variables:

```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=optional_password
```

### Connection Options

The Redis client is configured with the following options for reliability:

- `lazyConnect: false` - Establishes connection immediately
- `enableOfflineQueue: true` - Queues commands when offline
- `enableReadyCheck: true` - Waits for Redis ready state
- `retryDelayOnFailover: 100` - Quick failover retry
- `maxRetriesPerRequest: 3` - Limited retry attempts

## Health Monitoring

The RedisService includes health checking capabilities for use with NestJS health checks:

```typescript
import { HealthIndicator, HealthCheckError } from '@nestjs/terminus';
import { RedisService } from '@engram/redis';

// The RedisService.isHealthy() method returns a Promise<boolean>
const isHealthy = await redisService.isHealthy();
```

### Health Check Features

- Connection status verification
- Timeout protection (5 second limit)
- Robust error handling
- Production-ready monitoring

## Development

### Testing

Run the Redis service tests:

```bash
pnpm test packages/redis
```

### Integration Testing

The package includes integration tests that verify:

- Redis connection establishment
- Health check functionality
- Error handling scenarios

## Dependencies

- `ioredis` - High-performance Redis client
- `@nestjs/common` - NestJS core functionality
- `@nestjs/config` - Configuration management

## Related Packages

- `@engram/database` - PostgreSQL database layer
- `@engram/config` - Environment configuration
- `@engram/core` - Core MCP functionality
