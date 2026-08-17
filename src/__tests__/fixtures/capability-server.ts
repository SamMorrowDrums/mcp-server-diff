import { createInterface } from "node:readline";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

const mode = process.argv[2] ?? "discover";
const capabilityMetaKey = "io.modelcontextprotocol/clientCapabilities";
let initializedCapabilities: Record<string, unknown> = {};

function capabilitiesFromMeta(params?: Record<string, unknown>): Record<string, unknown> {
  const meta = params?._meta;
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    return initializedCapabilities;
  }
  const capabilities = (meta as Record<string, unknown>)[capabilityMetaKey];
  return typeof capabilities === "object" && capabilities !== null && !Array.isArray(capabilities)
    ? (capabilities as Record<string, unknown>)
    : initializedCapabilities;
}

function respond(id: number, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function respondError(id: number, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  const request = JSON.parse(line) as JsonRpcRequest;

  if (request.method === "server/discover") {
    if (mode === "legacy") {
      respondError(request.id!, -32601, "Method not found");
      return;
    }
    const capabilities = capabilitiesFromMeta(request.params);
    respond(request.id!, {
      supportedVersions: ["2026-07-28"],
      capabilities: { tools: {} },
      serverInfo: {
        name: "capability-echo-server",
        version: JSON.stringify(capabilities),
      },
    });
    return;
  }

  if (request.method === "initialize") {
    const capabilities = request.params?.capabilities;
    initializedCapabilities =
      typeof capabilities === "object" && capabilities !== null && !Array.isArray(capabilities)
        ? (capabilities as Record<string, unknown>)
        : {};
    respond(request.id!, {
      protocolVersion: request.params?.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: {
        name: "capability-echo-server",
        version: JSON.stringify(initializedCapabilities),
      },
    });
    return;
  }

  if (request.method === "tools/list") {
    const capabilities = capabilitiesFromMeta(request.params);
    respond(request.id!, {
      tools: [
        {
          name: "capability_echo",
          description: JSON.stringify(capabilities),
          inputSchema: { type: "object" },
        },
      ],
    });
  }
});
