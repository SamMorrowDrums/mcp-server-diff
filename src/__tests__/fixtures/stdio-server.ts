#!/usr/bin/env npx tsx
/**
 * Minimal MCP Server for integration testing (stdio transport)
 *
 * This server exposes tools, prompts, and resources for testing the probe functionality.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "test-stdio-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
      resources: {},
    },
  }
);

// Define tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "greet",
        description: "Greets a person by name",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "Name to greet" },
          },
          required: ["name"],
        },
      },
      {
        name: "add",
        description: "Adds two numbers",
        inputSchema: {
          type: "object" as const,
          properties: {
            a: { type: "number", description: "First number" },
            b: { type: "number", description: "Second number" },
          },
          required: ["a", "b"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "greet") {
    return {
      content: [{ type: "text", text: `Hello, ${(args as { name: string }).name}!` }],
    };
  }

  if (name === "add") {
    const { a, b } = args as { a: number; b: number };
    // Return as embedded JSON to test normalization
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ result: a + b, operation: "add", inputs: { b, a } }),
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Define prompts
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "code-review",
        description: "Review code for issues",
        arguments: [
          { name: "code", description: "The code to review", required: true },
          { name: "language", description: "Programming language", required: false },
        ],
      },
    ],
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name === "code-review") {
    const args = request.params.arguments || {};
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Please review this ${args.language || "code"}:\n\n${args.code}`,
          },
        },
      ],
    };
  }
  throw new Error(`Unknown prompt: ${request.params.name}`);
});

// Define resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "test://readme",
        name: "README",
        description: "Project readme file",
        mimeType: "text/plain",
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === "test://readme") {
    return {
      contents: [
        {
          uri: "test://readme",
          mimeType: "text/plain",
          text: "# Test Server\n\nThis is a test MCP server.",
        },
      ],
    };
  }
  throw new Error(`Unknown resource: ${request.params.uri}`);
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
