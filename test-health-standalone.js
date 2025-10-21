#!/usr/bin/env node
/**
 * Standalone Health Check Test
 *
 * This script tests the health check logic independently
 * without requiring the full NestJS application to start.
 */

// Mock the health check functionality
class MockPrismaService {
  async $queryRaw() {
    return [{ 1: 1 }];
  }
}

class MockRedisService {
  async isHealthy() {
    return true;
  }
}

class MockQdrantService {
  async healthCheck() {
    return true;
  }
}

// Simulate the health indicators
class PrismaHealthIndicator {
  constructor(prismaService) {
    this.prismaService = prismaService;
  }

  async isHealthy(key) {
    try {
      await this.prismaService.$queryRaw();
      return { [key]: { status: 'up' } };
    } catch {
      return { [key]: { status: 'down' } };
    }
  }
}

class RedisHealthIndicator {
  constructor(redisService) {
    this.redisService = redisService;
  }

  async isHealthy(key) {
    const healthy = await this.redisService.isHealthy();
    return { [key]: { status: healthy ? 'up' : 'down' } };
  }
}

class QdrantHealthIndicator {
  constructor(qdrantService) {
    this.qdrantService = qdrantService;
  }

  async isHealthy(key) {
    const healthy = await this.qdrantService.healthCheck();
    return { [key]: { status: healthy ? 'up' : 'down' } };
  }
}

// Simulate the health check controller
class HealthController {
  constructor() {
    this.prismaHealth = new PrismaHealthIndicator(new MockPrismaService());
    this.redisHealth = new RedisHealthIndicator(new MockRedisService());
    this.qdrantHealth = new QdrantHealthIndicator(new MockQdrantService());
  }

  async check() {
    try {
      const [database, redis, qdrant] = await Promise.all([
        this.prismaHealth.isHealthy('database'),
        this.redisHealth.isHealthy('redis'),
        this.qdrantHealth.isHealthy('qdrant'),
      ]);

      const details = { ...database, ...redis, ...qdrant };
      const allHealthy = Object.values(details).every((service) => service.status === 'up');

      return {
        status: allHealthy ? 'ok' : 'error',
        info: allHealthy ? details : {},
        error: allHealthy
          ? {}
          : Object.fromEntries(
              Object.entries(details).filter(([, service]) => service.status === 'down')
            ),
        details,
      };
    } catch (error) {
      return {
        status: 'error',
        info: {},
        error: { general: { status: 'down', message: error.message } },
        details: { general: { status: 'down', message: error.message } },
      };
    }
  }
}

// Test scenarios
async function runTests() {
  console.log('🏥 Health Check System Test\n');

  const healthController = new HealthController();

  console.log('📊 Test 1: All services healthy');
  const healthyResult = await healthController.check();
  console.log(JSON.stringify(healthyResult, null, 2));

  console.log('\n📊 Test 2: Simulating Redis failure');
  // Mock Redis failure
  healthController.redisHealth.redisService.isHealthy = async () => false;
  const redisFailResult = await healthController.check();
  console.log(JSON.stringify(redisFailResult, null, 2));

  console.log('\n📊 Test 3: Simulating Database failure');
  // Mock Prisma failure
  healthController.prismaHealth.prismaService.$queryRaw = async () => {
    throw new Error('Connection failed');
  };
  const dbFailResult = await healthController.check();
  console.log(JSON.stringify(dbFailResult, null, 2));

  console.log('\n✅ All tests completed!');
}

// Run the tests
runTests().catch(console.error);
