#!/usr/bin/env npx tsx
/**
 * Minimal MCP Server for integration testing (streamable-http transport)
 *
 * Run with: npx tsx http-server.ts <port>
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as http from "http";

const server = new Server(
  {
    name: "test-http-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "echo",
        description: "Echoes back the input",
        inputSchema: {
          type: "object" as const,
          properties: {
            message: { type: "string", description: "Message to echo" },
          },
          required: ["message"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "echo") {
    return {
      content: [{ type: "text", text: (args as { message: string }).message }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Create HTTP server with streamable transport
async function main() {
  const httpServer = http.createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  httpServer.on("request", async (req, res) => {
    // Simple CORS support
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.url === "/mcp" || req.url?.startsWith("/mcp?")) {
      await transport.handleRequest(req, res);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  await server.connect(transport);

  // Use port 0 to let the OS assign a free port, unless specific port given
  const requestedPort = parseInt(process.argv[2] || "0", 10);
  httpServer.listen(requestedPort, () => {
    const addr = httpServer.address();
    const actualPort = typeof addr === "object" && addr ? addr.port : requestedPort;
    // Output format that tests parse: "listening on port XXXXX"
    console.log(`Test HTTP MCP server listening on port ${actualPort}`);
  });

  // Handle shutdown
  process.on("SIGTERM", () => {
    httpServer.close();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    httpServer.close();
    process.exit(0);
  });
}

main().catch(console.error);
