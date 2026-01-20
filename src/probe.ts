/**
 * MCP Server Probe
 *
 * Probes an MCP server and collects capability snapshots.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as core from "@actions/core";
import { z } from "zod";
import type {
  ProbeResult,
  InitializeInfo,
  ToolsResult,
  PromptsResult,
  ResourcesResult,
  ResourceTemplatesResult,
  CustomMessage,
} from "./types.js";

export interface ProbeOptions {
  transport: "stdio" | "streamable-http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  workingDir?: string;
  envVars?: Record<string, string>;
  customMessages?: CustomMessage[];
}

/**
 * Probes an MCP server and returns capability snapshots
 */
export async function probeServer(options: ProbeOptions): Promise<ProbeResult> {
  const result: ProbeResult = {
    initialize: null,
    tools: null,
    prompts: null,
    resources: null,
    resourceTemplates: null,
    customResponses: new Map(),
  };

  const client = new Client(
    {
      name: "mcp-server-diff-probe",
      version: "2.0.0",
    },
    {
      capabilities: {},
    }
  );

  let transport: StdioClientTransport | StreamableHTTPClientTransport;

  try {
    if (options.transport === "stdio") {
      if (!options.command) {
        throw new Error("Command is required for stdio transport");
      }

      core.info(`  Connecting via stdio: ${options.command} ${(options.args || []).join(" ")}`);

      // Merge environment variables
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
          env[key] = value;
        }
      }
      for (const [key, value] of Object.entries(options.envVars || {})) {
        env[key] = value;
      }

      transport = new StdioClientTransport({
        command: options.command,
        args: options.args || [],
        env,
        cwd: options.workingDir,
      });
    } else {
      if (!options.url) {
        throw new Error("URL is required for streamable-http transport");
      }

      core.info(`  Connecting via streamable-http: ${options.url}`);
      const transportOptions: { requestInit?: RequestInit } = {};
      if (options.headers && Object.keys(options.headers).length > 0) {
        transportOptions.requestInit = { headers: options.headers };
        core.info(`  With headers: ${Object.keys(options.headers).join(", ")}`);
      }
      transport = new StreamableHTTPClientTransport(new URL(options.url), transportOptions);
    }

    // Connect to the server
    await client.connect(transport);
    core.info("  Connected successfully");

    // Get server info and capabilities
    const serverCapabilities = client.getServerCapabilities();
    const serverInfo = client.getServerVersion();

    result.initialize = {
      serverInfo,
      capabilities: serverCapabilities,
    } as InitializeInfo;

    // Probe tools if supported
    if (serverCapabilities?.tools) {
      try {
        const toolsResult = await client.listTools();
        result.tools = toolsResult as ToolsResult;
        core.info(`  Listed ${result.tools.tools.length} tools`);
      } catch (error) {
        core.warning(`  Failed to list tools: ${error}`);
      }
    } else {
      core.info("  Server does not support tools");
    }

    // Probe prompts if supported
    if (serverCapabilities?.prompts) {
      try {
        const promptsResult = await client.listPrompts();
        result.prompts = promptsResult as PromptsResult;
        core.info(`  Listed ${result.prompts.prompts.length} prompts`);
      } catch (error) {
        core.warning(`  Failed to list prompts: ${error}`);
      }
    } else {
      core.info("  Server does not support prompts");
    }

    // Probe resources if supported
    if (serverCapabilities?.resources) {
      try {
        const resourcesResult = await client.listResources();
        result.resources = resourcesResult as ResourcesResult;
        core.info(`  Listed ${result.resources.resources.length} resources`);
      } catch (error) {
        core.warning(`  Failed to list resources: ${error}`);
      }

      // Also get resource templates
      try {
        const templatesResult = await client.listResourceTemplates();
        result.resourceTemplates = templatesResult as ResourceTemplatesResult;
        core.info(
          `  Listed ${result.resourceTemplates.resourceTemplates.length} resource templates`
        );
      } catch (error) {
        core.warning(`  Failed to list resource templates: ${error}`);
      }
    } else {
      core.info("  Server does not support resources");
    }

    // Send custom messages if provided
    if (options.customMessages && options.customMessages.length > 0) {
      // Schema that accepts any response for custom messages
      const anyResponseSchema = z.record(z.unknown());

      for (const customMsg of options.customMessages) {
        try {
          // Cast message to the expected request type - custom messages should have a method field
          const response = await client.request(
            customMsg.message as { method: string; params?: Record<string, unknown> },
            anyResponseSchema
          );
          result.customResponses.set(customMsg.name, response);
          core.info(`  Custom message '${customMsg.name}' successful`);
        } catch (error) {
          core.warning(`  Custom message '${customMsg.name}' failed: ${error}`);
        }
      }
    }

    core.info("  Probe complete");

    // Close the connection
    await client.close();
  } catch (error) {
    result.error = String(error);
    core.error(`  Error probing server: ${error}`);

    // Try to close client on error
    try {
      await client.close();
    } catch {
      // Ignore close errors
    }
  }

  return result;
}

/**
 * Get a sort key for an array element based on common MCP entity patterns.
 * This ensures deterministic sorting for tools, prompts, resources, etc.
 */
function getSortKey(item: unknown): string {
  if (item === null || item === undefined) {
    return "";
  }

  if (typeof item !== "object") {
    return String(item);
  }

  const obj = item as Record<string, unknown>;

  // Primary sort keys for MCP entities (in priority order)
  // Tools, prompts, arguments: use "name"
  // Resources, resource templates: use "uri" or "uriTemplate"
  // Content items: use "uri" or "type"
  if (typeof obj.name === "string") {
    return obj.name;
  }
  if (typeof obj.uri === "string") {
    return obj.uri;
  }
  if (typeof obj.uriTemplate === "string") {
    return obj.uriTemplate;
  }
  if (typeof obj.type === "string") {
    return obj.type;
  }
  if (typeof obj.method === "string") {
    return obj.method;
  }

  // Fallback to JSON string - but normalize first to ensure deterministic output
  return JSON.stringify(normalizeProbeResult(item));
}

/**
 * Normalize a probe result for comparison by sorting keys and arrays recursively.
 * Also handles embedded JSON strings in "text" fields (from tool call responses).
 *
 * Sorting strategy:
 * - Object keys: sorted alphabetically
 * - Arrays of objects: sorted by primary key (name, uri, type) for deterministic output
 * - Primitive arrays: sorted by string representation
 * - Embedded JSON in "text" fields: parsed, normalized, and re-serialized
 */
export function normalizeProbeResult(result: unknown): unknown {
  if (result === null || result === undefined) {
    return result;
  }

  if (Array.isArray(result)) {
    // First normalize all elements
    const normalized = result.map(normalizeProbeResult);

    // Then sort by sort key for deterministic output
    return normalized.sort((a, b) => {
      const aKey = getSortKey(a);
      const bKey = getSortKey(b);
      return aKey.localeCompare(bKey);
    });
  }

  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};

    // Sort keys alphabetically
    const keys = Object.keys(obj).sort();

    for (const key of keys) {
      let value = obj[key];

      // Handle embedded JSON in "text" fields (tool call responses)
      if (key === "text" && typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
          try {
            const parsed = JSON.parse(value);
            // Re-serialize the normalized JSON to keep it as a string
            value = JSON.stringify(normalizeProbeResult(parsed));
          } catch {
            // Not valid JSON, keep as-is
          }
        }
      }

      normalized[key] = normalizeProbeResult(value);
    }
    return normalized;
  }

  return result;
}

/**
 * Convert probe result to a map of endpoint -> JSON string
 */
export function probeResultToFiles(result: ProbeResult): Map<string, string> {
  const files = new Map<string, string>();

  if (result.initialize) {
    files.set("initialize", JSON.stringify(normalizeProbeResult(result.initialize), null, 2));
  }
  if (result.tools) {
    files.set("tools", JSON.stringify(normalizeProbeResult(result.tools), null, 2));
  }
  if (result.prompts) {
    files.set("prompts", JSON.stringify(normalizeProbeResult(result.prompts), null, 2));
  }
  if (result.resources) {
    files.set("resources", JSON.stringify(normalizeProbeResult(result.resources), null, 2));
  }
  if (result.resourceTemplates) {
    files.set(
      "resource_templates",
      JSON.stringify(normalizeProbeResult(result.resourceTemplates), null, 2)
    );
  }

  for (const [name, response] of result.customResponses.entries()) {
    files.set(`custom_${name}`, JSON.stringify(normalizeProbeResult(response), null, 2));
  }

  return files;
}
