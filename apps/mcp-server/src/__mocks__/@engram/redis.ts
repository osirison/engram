// Mock implementation of @engram/redis for Jest tests
export class RedisService {
  isHealthy(): boolean {
    return true;
  }
}

export class RedisModule {
  // Mirror the real RedisModule's dynamic-module API so callers that wire it
  // via `RedisModule.forRoot()` (e.g. HealthModule.forRoot) don't blow up.
  static forRoot(): {
    module: typeof RedisModule;
    providers: unknown[];
    exports: unknown[];
  } {
    return {
      module: RedisModule,
      providers: [RedisService],
      exports: [RedisService],
    };
  }
}
