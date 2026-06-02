#!/usr/bin/env node

import { execSync } from 'node:child_process';

const clientPort = process.env.INSPECTOR_CLIENT_PORT ?? '6274';
const mcpServerPort = process.env.MCP_SERVER_PORT ?? '3000';
const healthUrl = `http://localhost:${mcpServerPort}/health`;
const inspectorUrl =
  `http://localhost:${clientPort}/?transport=streamable-http&serverUrl=` +
  encodeURIComponent('http://mcp-server:3000/mcp');

function run(command) {
  console.log(`$ ${command}`);
  execSync(command, { stdio: 'inherit' });
}

async function waitForHttpOk(url, label, maxAttempts = 40, delayMs = 1500) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        console.log(`✓ ${label} is ready at ${url}`);
        return;
      }
    } catch {
      // Keep retrying until maxAttempts is reached.
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`${label} did not become ready at ${url}`);
}

run('docker compose --profile mcp-server --profile inspector up -d --build --wait postgres redis qdrant mcp-server inspector');

await waitForHttpOk(healthUrl, 'MCP server health endpoint');
await waitForHttpOk(`http://localhost:${clientPort}`, 'MCP Inspector UI');

console.log('');
console.log('Inspector stack is ready.');
console.log(`Open: ${inspectorUrl}`);
console.log('Stop with: npm exec --yes pnpm@11.4.0 -- docker:inspector:down');
