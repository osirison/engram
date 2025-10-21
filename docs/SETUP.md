# ENGRAM MCP Setup Guide

This guide walks you through setting up ENGRAM as a Model Context Protocol (MCP) server that can be used with Claude Desktop and other MCP clients.

## Prerequisites

Before starting, ensure you have:

- ✅ Node.js 20+ installed
- ✅ pnpm package manager installed
- ✅ Docker and Docker Compose installed
- ✅ Claude Desktop application installed
- ✅ Git for cloning the repository

## 1. Initial Setup

### Clone and Install Dependencies

```bash
# Clone the repository
git clone https://github.com/osirison/engram.git
cd engram

# Install dependencies
pnpm install

# Start required services (PostgreSQL, Redis, Qdrant)
pnpm docker:up
```

### Environment Configuration

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your database credentials
# The default values should work with the Docker setup
```

### Database Setup

```bash
# Generate Prisma client
pnpm db:generate

# Run database migrations
pnpm db:migrate

# Optional: Seed with sample data
pnpm db:seed
```

## 2. Build and Test ENGRAM Server

### Build the MCP Server

```bash
# Build all packages
pnpm build

# Verify the MCP server builds successfully
cd apps/mcp-server
pnpm build
```

### Test Server Startup

```bash
# From the root directory, start in development mode
pnpm dev

# The server should start and show:
# ✅ Database connected
# ✅ Redis connected  
# ✅ Qdrant connected
# ✅ MCP server listening on stdio
```

### Verify Server Health

```bash
# In another terminal, test the health endpoint
node test-health-standalone.js

# Should return: { status: 'ok', timestamp: '...' }
```

## 3. Claude Desktop Configuration

### Locate Configuration File

The Claude Desktop configuration file location depends on your operating system:

**Windows:**

```text
%APPDATA%\Claude\claude_desktop_config.json
```

**macOS:**

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Linux:**

```text
~/.config/Claude/claude_desktop_config.json
```

### Create Configuration

1. **Copy the example configuration:**
   ```bash
   # From your ENGRAM project root
   cp claude_desktop_config.json.example claude_desktop_config.json
   ```

2. **Edit the configuration file** with the correct paths for your system:

   ```json
   {
     "mcpServers": {
       "engram": {
         "command": "node",
         "args": ["/absolute/path/to/your/engram/apps/mcp-server/dist/main.js"],
         "env": {
           "DATABASE_URL": "postgresql://postgres:password@localhost:5432/engram",
           "REDIS_URL": "redis://localhost:6379",
           "QDRANT_URL": "http://localhost:6333",
           "NODE_ENV": "production"
         }
       }
     }
   }
   ```

3. **Update the file path** in the `args` array to match your ENGRAM installation directory.

4. **Copy the configuration** to Claude Desktop's config location:

   **Windows:**
   ```bash
   Copy-Item claude_desktop_config.json "$env:APPDATA\Claude\claude_desktop_config.json"
   ```

   **macOS/Linux:**
   ```bash
   cp claude_desktop_config.json ~/Library/Application\ Support/Claude/claude_desktop_config.json
   ```

## 4. Testing the Connection

### Start ENGRAM Server

```bash
# Ensure Docker services are running
pnpm docker:up

# Start ENGRAM in production mode
pnpm build
cd apps/mcp-server
node dist/main.js
```

The server should start and wait for MCP connections on stdio.

### Restart Claude Desktop

1. **Completely quit Claude Desktop** (check system tray/menu bar)
2. **Restart Claude Desktop**
3. **Look for the ENGRAM connection** in the status bar or settings

### Test MCP Tools

Once Claude Desktop has restarted, test the connection by asking Claude to:

1. **Test basic connectivity:**

   ```text
   Can you call the ping tool to test the ENGRAM connection?
   ```

2. **List available tools:**

   ```text
   What MCP tools are available from ENGRAM?
   ```

3. **Test memory operations:**

   ```text
   Can you store a test memory in ENGRAM?
   ```

### Expected Responses

- ✅ **Ping test:** Should return a success response with timestamp
- ✅ **Tool list:** Should show available ENGRAM tools (memory storage, retrieval, etc.)
- ✅ **Memory operations:** Should successfully store and retrieve test data

## 5. Troubleshooting

### Common Issues

#### "Connection Failed" or "Server Not Found"

1. **Check file paths:**
   ```bash
   # Verify the dist folder exists
   ls -la apps/mcp-server/dist/
   
   # Should contain main.js
   ```

2. **Verify build completed:**
   ```bash
   pnpm build
   cd apps/mcp-server && pnpm build
   ```

3. **Test server manually:**
   ```bash
   cd apps/mcp-server
   node dist/main.js
   # Should start without errors
   ```

#### "Database Connection Error"

1. **Check Docker services:**
   ```bash
   pnpm docker:ps
   # Should show postgres, redis, and qdrant running
   ```

2. **Verify environment variables:**
   ```bash
   # Check .env file has correct DATABASE_URL
   cat .env | grep DATABASE_URL
   ```

3. **Test database connection:**
   ```bash
   pnpm db:generate
   # Should connect successfully
   ```

#### "Tools Not Available" in Claude Desktop

1. **Check Claude Desktop logs** (if available in the app)
2. **Verify configuration file location and format:**
   ```bash
   # Check JSON syntax
   cat ~/.config/Claude/claude_desktop_config.json | jq .
   ```

3. **Restart Claude Desktop completely:**
   - Quit from system tray/menu bar
   - Wait 10 seconds
   - Restart application

#### "Permission Denied" or "Command Not Found"

1. **Check Node.js version:**
   ```bash
   node --version
   # Should be 20.0.0 or higher
   ```

2. **Verify file permissions:**
   ```bash
   chmod +x apps/mcp-server/dist/main.js
   ```

3. **Use absolute paths** in Claude Desktop config

### Debug Mode

For detailed debugging, run ENGRAM with debug logging:

```bash
# Set debug environment
export DEBUG=engram:*

# Start with verbose logging
cd apps/mcp-server
node dist/main.js
```

### Health Check

Verify all services are healthy:

```bash
# Check ENGRAM health
node test-health-standalone.js

# Check Docker services
pnpm docker:ps

# Check database
pnpm db:studio
```

## 6. Development vs Production

### Development Mode

For development, you can run ENGRAM in watch mode:

```bash
pnpm dev
```

This will automatically rebuild and restart when files change.

### Production Mode

For production usage with Claude Desktop:

```bash
# Build once
pnpm build

# Run built version
cd apps/mcp-server
node dist/main.js
```

The production build is optimized and starts faster.

## 7. Next Steps

Once ENGRAM is connected successfully:

1. **Explore memory features** - Ask Claude to store and retrieve memories
2. **Test semantic search** - Store related information and search for it
3. **Try conversation context** - Have multi-turn conversations using memory
4. **Check analytics** - Monitor memory usage and patterns

## 8. Support

If you encounter issues not covered in this guide:

1. **Check the logs** in both ENGRAM and Claude Desktop
2. **Verify prerequisites** are correctly installed
3. **Review the configuration** for typos or incorrect paths
4. **Test components individually** (database, server, etc.)

For additional help, please refer to the [project documentation](../README.md) or open an issue on GitHub.
