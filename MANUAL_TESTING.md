# Manual Testing Guide - Health Check System

## 🚀 Quick Start

### 1. Set Up Environment

```powershell
# Copy environment file
Copy-Item .env.example .env

# Start dependencies with Docker
docker-compose up -d

# Install dependencies
pnpm install

# Generate Prisma client
pnpm db:generate

# Start the server
cd apps/mcp-server
pnpm dev
```

### 2. Test Health Endpoints

#### ✅ **Test All Services Healthy**

```powershell
# Using curl
curl http://localhost:3001/health

# Using PowerShell Invoke-RestMethod
Invoke-RestMethod -Uri "http://localhost:3001/health" -Method GET | ConvertTo-Json -Depth 10
```

**Expected Response (200 OK):**

```json
{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "redis": { "status": "up" },
    "qdrant": { "status": "up" }
  },
  "error": {},
  "details": {
    "database": { "status": "up" },
    "redis": { "status": "up" },
    "qdrant": { "status": "up" }
  }
}
```

#### ❌ **Test Service Failures**

**Stop PostgreSQL:**

```powershell
docker stop engram-postgres

# Test health endpoint
curl http://localhost:3001/health
```

**Expected Response (503 Service Unavailable):**

```json
{
  "status": "error",
  "info": {},
  "error": {
    "database": {
      "status": "down",
      "message": "Connection failed"
    }
  },
  "details": {
    "database": { "status": "down", "message": "Connection failed" },
    "redis": { "status": "up" },
    "qdrant": { "status": "up" }
  }
}
```

**Stop Redis:**

```powershell
docker stop engram-redis

# Test health endpoint
curl http://localhost:3001/health
```

**Stop Qdrant:**

```powershell
docker stop engram-qdrant

# Test health endpoint
curl http://localhost:3001/health
```

### 3. Individual Service Tests

#### Test Database Only

```powershell
# Custom endpoint (if available)
curl http://localhost:3001/health/database
```

#### Test Redis Only

```powershell
# Custom endpoint (if available)
curl http://localhost:3001/health/redis
```

#### Test Qdrant Only

```powershell
# Custom endpoint (if available)
curl http://localhost:3001/health/qdrant
```

## 🔧 Troubleshooting

### Check Service Status

```powershell
# Check all Docker containers
docker ps

# Check specific container logs
docker logs engram-postgres
docker logs engram-redis
docker logs engram-qdrant

# Check MCP server logs
cd apps/mcp-server
pnpm dev  # Watch the console output
```

### Common Issues

#### 1. Port Conflicts

```powershell
# Check what's using ports
netstat -ano | findstr :3001
netstat -ano | findstr :5432
netstat -ano | findstr :6379
netstat -ano | findstr :6333
```

#### 2. Database Connection

```powershell
# Test direct PostgreSQL connection
docker exec -it engram-postgres psql -U engram -d engram -c "SELECT 1;"
```

#### 3. Redis Connection

```powershell
# Test direct Redis connection
docker exec -it engram-redis redis-cli ping
```

#### 4. Qdrant Connection

```powershell
# Test direct Qdrant connection
curl http://localhost:6333/health
```

### Reset Everything

```powershell
# Stop and remove all containers
docker-compose down -v

# Remove volumes (WARNING: This deletes all data)
docker volume rm engram_postgres_data engram_redis_data engram_qdrant_data

# Start fresh
docker-compose up -d
```

## 📊 Testing Scenarios

### Scenario 1: Full System Health

1. ✅ Start all services with `docker-compose up -d`
2. ✅ Start MCP server with `pnpm dev`
3. ✅ Test `/health` endpoint → Should return 200 OK

### Scenario 2: Database Failure

1. ❌ Stop PostgreSQL: `docker stop engram-postgres`
2. 🧪 Test `/health` endpoint → Should return 503 with database error

### Scenario 3: Redis Failure

1. ❌ Stop Redis: `docker stop engram-redis`
2. 🧪 Test `/health` endpoint → Should return 503 with redis error

### Scenario 4: Qdrant Failure

1. ❌ Stop Qdrant: `docker stop engram-qdrant`
2. 🧪 Test `/health` endpoint → Should return 503 with qdrant error

### Scenario 5: Multiple Failures

1. ❌ Stop multiple services
2. 🧪 Test `/health` endpoint → Should return 503 with multiple errors

### Scenario 6: Recovery Testing

1. ✅ Restart stopped services: `docker start engram-postgres engram-redis engram-qdrant`
2. 🧪 Test `/health` endpoint → Should return 200 OK after brief delay

## 🌐 Browser Testing

Visit in your browser:

- **Health Check**: http://localhost:3001/health
- **Qdrant UI**: http://localhost:6333/dashboard (if Qdrant has web UI)

## 📱 Postman Collection

Create a Postman collection with these requests:

1. **GET Health Check**
   - URL: `http://localhost:3001/health`
   - Expected: 200 OK or 503 Service Unavailable

2. **GET Qdrant Direct**
   - URL: `http://localhost:6333/health`
   - Expected: 200 OK

## 🔍 Advanced Testing

### Load Testing

```powershell
# Use curl in a loop
for ($i=1; $i -le 10; $i++) {
    Write-Host "Request $i"
    curl http://localhost:3001/health
    Start-Sleep -Seconds 1
}
```

### Timing Tests

```powershell
# Measure response time
Measure-Command { Invoke-RestMethod -Uri "http://localhost:3001/health" }
```

### Concurrent Tests

```powershell
# Run multiple requests simultaneously
1..5 | ForEach-Object -Parallel {
    Invoke-RestMethod -Uri "http://localhost:3001/health"
}
```

## ✅ Success Criteria

- ✅ Health endpoint responds in < 2 seconds
- ✅ Returns 200 when all services are healthy
- ✅ Returns 503 when any service is unhealthy
- ✅ Proper error messages for each failed service
- ✅ System recovers automatically when services restart
- ✅ No memory leaks during extended testing
