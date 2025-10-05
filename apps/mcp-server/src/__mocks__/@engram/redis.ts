// Mock implementation of @engram/redis for Jest tests
export class RedisService {
  isHealthy(): boolean {
    return true;
  }
}

export class RedisModule {}
