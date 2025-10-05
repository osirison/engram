// Mock implementation of @engram/redis for Jest tests
export class RedisService {
  async isHealthy(): Promise<boolean> {
    return true;
  }
}

export class RedisModule {}
