# ENGRAM MCP Server

The Model Context Protocol (MCP) server for ENGRAM - provides the core API for AI agent memory management.

## Description

This NestJS application serves as the main API server for ENGRAM, implementing the Model Context Protocol for seamless integration with AI agents and applications.

## Configuration

The server uses environment variables for configuration. See `.env.example` in the project root for all available options.

**Key Configuration:**

- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production/test)
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `QDRANT_URL` - Qdrant vector database URL

## Development

### Prerequisites

Ensure all infrastructure services are running:

```bash
# From project root
pnpm docker:up
```

This starts:

- PostgreSQL (port 5432)
- Redis (port 6379)
- Qdrant (port 6333)

### Running the Server

```bash
# Development mode with hot reload
pnpm start:dev

# Production mode
pnpm build
pnpm start:prod

# Debug mode
pnpm start:debug
```

The server will be available at `http://localhost:3000`

## API Endpoints

### Health Check

The `/health` endpoint provides comprehensive health status for all service dependencies using [@nestjs/terminus](https://docs.nestjs.com/recipes/terminus).

```bash
# Check overall health (all services)
curl http://localhost:3000/health

# Response when healthy (HTTP 200):
# {
#   "status": "ok",
#   "info": {
#     "database": {
#       "status": "up"
#     },
#     "redis": {
#       "status": "up"
#     },
#     "qdrant": {
#       "status": "up"
#     }
#   },
#   "error": {},
#   "details": {
#     "database": {
#       "status": "up"
#     },
#     "redis": {
#       "status": "up"
#     },
#     "qdrant": {
#       "status": "up"
#     }
#   }
# }

# Response when unhealthy (HTTP 503):
# {
#   "status": "error",
#   "info": {},
#   "error": {
#     "database": {
#       "status": "down"
#     }
#   },
#   "details": {
#     "database": {
#       "status": "down"
#     },
#     "redis": {
#       "status": "up"
#     },
#     "qdrant": {
#       "status": "up"
#     }
#   }
# }
```

**Monitored Services:**

- **PostgreSQL** - Database connection via Prisma
- **Redis** - Cache connection
- **Qdrant** - Vector database connection

**Performance:** Health checks are optimized for fast response times (<100ms) using simple connectivity tests.

### Additional Endpoints

As the project develops, additional MCP endpoints will be documented here.

## Testing

```bash
# Unit tests
pnpm test

# E2E tests
pnpm test:e2e

# Test coverage
pnpm test:cov

# Watch mode
pnpm test:watch
```

## Project Structure

```
src/
├── app.module.ts      # Main application module
├── app.controller.ts  # Root controller
├── app.service.ts     # Root service
├── health.controller.ts # Health check endpoints
└── main.ts            # Application entry point
```

## Features

- ✅ **Structured Logging** - Pino logger with JSON output
- ✅ **Health Checks** - Monitor service dependencies
- ✅ **Vector Store** - Qdrant integration for semantic search
- ✅ **Configuration** - Environment-based config with validation
- 🚧 **MCP Protocol** - Memory management endpoints (in progress)

## Deployment

See the main [ENGRAM README](../../README.md) for deployment instructions.

## License

MIT
