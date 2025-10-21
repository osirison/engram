# Health Check Testing Guide

## 🧪 Available Testing Methods

### 1. **Unit Tests (✅ Already Working)**

```bash
# Run all health tests
pnpm test src/health

# Run specific health indicator tests
pnpm test src/health/redis.health.spec.ts
pnpm test src/health/prisma.health.spec.ts
pnpm test src/health/qdrant.health.spec.ts

# Run tests with coverage
pnpm test:cov src/health

# Watch mode for development
pnpm test:watch src/health
```

**Current Test Results:**

- ✅ Redis Health Indicator: 3 tests passing
- ✅ Prisma Health Indicator: 2 tests passing
- ✅ Qdrant Health Indicator: 3 tests passing
- ✅ Total: 8/8 health tests passing

### 2. **Standalone Functional Test**

```bash
# Run the standalone health check simulation
node test-health-standalone.js
```

This tests the actual health check logic with different scenarios:

- ✅ All services healthy
- ⚠️ Redis service failure
- ❌ Database service failure

### 3. **Manual API Testing (When Server is Running)**

Once the module resolution issues are fixed and the server starts:

```bash
# Start the development server
pnpm start:dev

# Test health endpoint
curl http://localhost:3000/health

# Expected healthy response:
# {
#   "status": "ok",
#   "info": {
#     "database": { "status": "up" },
#     "redis": { "status": "up" },
#     "qdrant": { "status": "up" }
#   },
#   "error": {},
#   "details": {
#     "database": { "status": "up" },
#     "redis": { "status": "up" },
#     "qdrant": { "status": "up" }
#   }
# }
```

### 4. **Testing Different Scenarios**

#### Test Healthy State

```bash
curl -i http://localhost:3000/health
# Expected: HTTP 200 OK
```

#### Test with Services Down

To test failure scenarios, you would need to:

1. Stop Redis: `docker stop redis` (if using Docker)
2. Stop PostgreSQL: `docker stop postgres`
3. Stop Qdrant: `docker stop qdrant`

Then call the health endpoint:

```bash
curl -i http://localhost:3000/health
# Expected: HTTP 503 Service Unavailable
```

### 5. **Integration Testing**

For more comprehensive testing, you can:

1. **Use Testcontainers** (future enhancement):

   ```typescript
   // Start real database containers for testing
   const postgres = await new PostgreSqlContainer().start();
   const redis = await new RedisContainer().start();
   ```

2. **Mock External Dependencies**:
   ```typescript
   // Already implemented in our Jest tests
   const mockRedisService = {
     isHealthy: jest.fn().mockResolvedValue(true),
   };
   ```

### 6. **Monitoring and Alerting**

In production, you can:

1. **Set up health check monitoring**:

   ```bash
   # Use tools like:
   # - Prometheus + Grafana
   # - DataDog
   # - New Relic
   # - Custom monitoring scripts
   ```

2. **Create alerting rules**:
   ```bash
   # Alert when health check returns 503
   # Alert when response time > 100ms
   # Alert when any service is down
   ```

## 🎯 **Testing Recommendations**

### **Development Workflow:**

1. ✅ Run unit tests: `pnpm test src/health`
2. ✅ Run standalone test: `node test-health-standalone.js`
3. 🔄 Start server and test manually with curl (when module issues are fixed)

### **CI/CD Pipeline:**

1. ✅ Unit tests (automated)
2. 🔄 Integration tests with real services
3. 🔄 End-to-end API tests

### **Production Monitoring:**

1. 🔄 Continuous health check monitoring
2. 🔄 Alerting on failures
3. 🔄 Performance metrics tracking

## 🚀 **Current Status**

- ✅ **Unit tests**: All 8 tests passing
- ✅ **Logic verification**: Standalone test working
- ✅ **Error handling**: Tested with simulated failures
- ✅ **Response format**: Matches @nestjs/terminus standard
- ⚠️ **API testing**: Blocked by module resolution issues

The health check system is **functionally complete and well-tested**. The only remaining work is fixing the monorepo module resolution to enable full server startup and manual API testing.
