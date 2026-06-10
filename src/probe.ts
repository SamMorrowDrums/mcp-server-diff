/**
 * MCP Server Probe
 *
 * Probes an MCP server and collects capability snapshots.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
import { log } from "./logger.js";

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
 * Check if an error is "Method not found" (-32601)
 */
function isMethodNotFound(error: unknown): boolean {
  const errorStr = String(error);
  return errorStr.includes("-32601") || errorStr.includes("Method not found");
}

/**
 * Probes an MCP server and returns capability snapshots
 */
export async function probeServer(options: ProbeOptions): Promise<ProbeResult> {
  const result: ProbeResult = {
    initialize: null,
    instructions: null,
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

      log.info(`  Connecting via stdio: ${options.command} ${(options.args || []).join(" ")}`);

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

      log.info(`  Connecting via streamable-http: ${options.url}`);
      const transportOptions: { requestInit?: RequestInit } = {};
      if (options.headers && Object.keys(options.headers).length > 0) {
        transportOptions.requestInit = { headers: options.headers };
        log.info(`  With headers: ${Object.keys(options.headers).join(", ")}`);
      }
      transport = new StreamableHTTPClientTransport(new URL(options.url), transportOptions);
    }

    // The SDK doesn't expose the negotiated protocol version via a public
    // getter. It does, however, call `transport.setProtocolVersion(...)` after
    // initialize if the transport implements it. Wrap (or attach) that hook so
    // we can capture the version for the snapshot. Works for stdio + HTTP.
    let negotiatedProtocolVersion: string | undefined;
    const transportWithHook = transport as {
      setProtocolVersion?: (version: string) => void;
    };
    const originalSetProtocolVersion = transportWithHook.setProtocolVersion?.bind(transport);
    transportWithHook.setProtocolVersion = (version: string) => {
      negotiatedProtocolVersion = version;
      originalSetProtocolVersion?.(version);
    };

    // Connect to the server
    await client.connect(transport);
    log.info("  Connected successfully");

    // Get server info and capabilities
    const serverCapabilities = client.getServerCapabilities();
    const serverInfo = client.getServerVersion();

    result.initialize = {
      protocolVersion: negotiatedProtocolVersion,
      serverInfo,
      capabilities: serverCapabilities,
    } as InitializeInfo;

    if (negotiatedProtocolVersion) {
      log.info(`  Negotiated MCP protocol version: ${negotiatedProtocolVersion}`);
    }

    // Get server instructions
    const instructions = client.getInstructions();
    if (instructions) {
      result.instructions = instructions;
      log.info(`  Got server instructions (${instructions.length} chars)`);
    }

    // Probe tools if supported
    if (serverCapabilities?.tools) {
      try {
        const toolsResult = await client.listTools();
        result.tools = toolsResult as ToolsResult;
        log.info(`  Listed ${result.tools.tools.length} tools`);
      } catch (error) {
        if (isMethodNotFound(error)) {
          log.info("  Server does not implement tools/list");
        } else {
          log.warning(`  Failed to list tools: ${error}`);
        }
      }
    } else {
      log.info("  Server does not support tools");
    }

    // Probe prompts if supported
    if (serverCapabilities?.prompts) {
      try {
        const promptsResult = await client.listPrompts();
        result.prompts = promptsResult as PromptsResult;
        log.info(`  Listed ${result.prompts.prompts.length} prompts`);
      } catch (error) {
        if (isMethodNotFound(error)) {
          log.info("  Server does not implement prompts/list");
        } else {
          log.warning(`  Failed to list prompts: ${error}`);
        }
      }
    } else {
      log.info("  Server does not support prompts");
    }

    // Probe resources if supported
    if (serverCapabilities?.resources) {
      try {
        const resourcesResult = await client.listResources();
        result.resources = resourcesResult as ResourcesResult;
        log.info(`  Listed ${result.resources.resources.length} resources`);
      } catch (error) {
        if (isMethodNotFound(error)) {
          log.info("  Server does not implement resources/list");
        } else {
          log.warning(`  Failed to list resources: ${error}`);
        }
      }

      // Also try resource templates - some servers support resources but not templates
      try {
        const templatesResult = await client.listResourceTemplates();
        result.resourceTemplates = templatesResult as ResourceTemplatesResult;
        log.info(
          `  Listed ${result.resourceTemplates.resourceTemplates.length} resource templates`
        );
      } catch (error) {
        if (isMethodNotFound(error)) {
          log.info("  Server does not implement resources/templates/list");
        } else {
          log.warning(`  Failed to list resource templates: ${error}`);
        }
      }
    } else {
      log.info("  Server does not support resources");
    }

    // Send custom messages if provided
    if (options.customMessages && options.customMessages.length > 0) {
      // Schema that accepts any response for custom messages
      const anyResponseSchema = z.record(z.string(), z.unknown());

      for (const customMsg of options.customMessages) {
        try {
          // Cast message to the expected request type - custom messages should have a method field
          const response = await client.request(
            customMsg.message as { method: string; params?: Record<string, unknown> },
            anyResponseSchema
          );
          result.customResponses.set(customMsg.name, response);
          log.info(`  Custom message '${customMsg.name}' successful`);
        } catch (error) {
          log.warning(`  Custom message '${customMsg.name}' failed: ${error}`);
        }
      }
    }

    log.info("  Probe complete");

    // Close the connection
    await client.close();
  } catch (error) {
    result.error = String(error);
    log.error(`  Error probing server: ${error}`);

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
 * Keys inside a `_meta` object that are pure MCP protocol plumbing or
 * cross-cutting tracing context — never part of the server's public surface
 * and almost always different between protocol revisions or runs. We strip
 * these from `_meta` everywhere they appear so spec-version churn doesn't
 * masquerade as an API change.
 *
 * - `io.modelcontextprotocol/*` — MCP-reserved prefix added in the draft for
 *   protocol-level annotations (clientInfo, clientCapabilities,
 *   protocolVersion, subscriptionId, logLevel, …)
 * - `traceparent` / `tracestate` / `baggage` — W3C trace context that some
 *   transports inject for OTel propagation
 */
const PROTOCOL_NOISE_META_PREFIXES = ["io.modelcontextprotocol/"];
const PROTOCOL_NOISE_META_EXACT = new Set(["traceparent", "tracestate", "baggage"]);

function isProtocolNoiseMetaKey(key: string): boolean {
  if (PROTOCOL_NOISE_META_EXACT.has(key)) return true;
  return PROTOCOL_NOISE_META_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Strip protocol-noise keys from a `_meta` object. Returns undefined if the
 * cleaned object is empty (so the caller can omit it).
 */
function cleanMetaObject(meta: Record<string, unknown>): Record<string, unknown> | undefined {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (isProtocolNoiseMetaKey(k)) continue;
    cleaned[k] = v;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

/**
 * Normalize a probe result for comparison by sorting keys and arrays recursively.
 * Also handles embedded JSON strings in "text" fields (from tool call responses).
 *
 * Sorting strategy:
 * - Object keys: sorted alphabetically (the MCP draft spec — see
 *   https://modelcontextprotocol.io/specification/draft — now requires
 *   deterministic ordering for list results; we've always done this)
 * - Arrays of objects: sorted by primary key (name, uri, type) for deterministic output
 * - Primitive arrays: sorted by string representation
 * - Embedded JSON in "text" fields: parsed, normalized, and re-serialized
 *
 * Cross-version noise stripping (always on):
 * - Recursively cleans `_meta` objects by dropping `io.modelcontextprotocol/*`
 *   keys (protocol plumbing introduced in the draft: protocolVersion,
 *   clientInfo, clientCapabilities, subscriptionId, logLevel) and W3C trace
 *   context (`traceparent`, `tracestate`, `baggage`). An emptied `_meta` is
 *   dropped entirely.
 *
 * Cache-hint stripping (opt-in via `stripCacheHints`):
 * - The draft spec adds `ttlMs` and `cacheScope` (CacheableResult, SEP-2461)
 *   to results of tools/list, prompts/list, resources/list, resources/read,
 *   and resources/templates/list. These are freshness/cache hints that vary
 *   run-to-run, so we strip them at the top level of each list/read result.
 */
export function normalizeProbeResult(
  result: unknown,
  options: { stripCacheHints?: boolean } = {}
): unknown {
  if (result === null || result === undefined) {
    return result;
  }

  if (Array.isArray(result)) {
    // First normalize all elements
    const normalized = result.map((item) => normalizeProbeResult(item));

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
      // Skip MCP draft CacheableResult hints at the top level of a list/read
      // result — see SEP-2461 in the draft changelog. These would otherwise
      // produce spurious diffs between runs.
      if (options.stripCacheHints && (key === "ttlMs" || key === "cacheScope")) {
        continue;
      }

      let value = obj[key];

      // Recursively scrub protocol-noise keys out of any `_meta` we encounter.
      // Drop the `_meta` entirely if nothing useful is left.
      if (key === "_meta" && value !== null && typeof value === "object") {
        const cleaned = cleanMetaObject(value as Record<string, unknown>);
        if (cleaned === undefined) continue;
        value = cleaned;
      }

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
 * Canonical snapshot file names. Endpoint renames in the spec (e.g. the
 * draft's `initialize` → `server/discover`, SEP-2575) should be mapped here
 * so a server moving from one spec revision to another shows up as a content
 * diff on a single file, not "endpoint removed + endpoint added".
 *
 * We currently keep `initialize` as the canonical name for that snapshot;
 * the constant exists so the mapping is explicit and easy to extend.
 */
export const CANONICAL_SNAPSHOT_NAMES = {
  initialize: "initialize",
  serverDiscover: "initialize",
  tools: "tools",
  prompts: "prompts",
  resources: "resources",
  resourceTemplates: "resource_templates",
} as const;

/**
 * Normalize an initialize snapshot for diffing. Drops `protocolVersion` and
 * `capabilities.experimental` from the comparison body because they're
 * expected to drift across spec revisions / SDK upgrades and aren't part of
 * the server's public surface. The reporter surfaces protocol-version
 * changes separately so they aren't silently swallowed.
 */
function normalizeInitializeForDiff(info: InitializeInfo): unknown {
  const {
    protocolVersion: _ignoredVersion,
    capabilities,
    ...rest
  } = info as InitializeInfo & {
    protocolVersion?: string;
  };
  let cleanedCapabilities: Record<string, unknown> | undefined = capabilities;
  if (capabilities && typeof capabilities === "object") {
    const { experimental: _ignoredExperimental, ...capRest } = capabilities as Record<
      string,
      unknown
    >;
    cleanedCapabilities = capRest;
  }
  return normalizeProbeResult({ ...rest, capabilities: cleanedCapabilities });
}

/**
 * Convert probe result to a map of endpoint -> JSON string
 */
export function probeResultToFiles(result: ProbeResult): Map<string, string> {
  const files = new Map<string, string>();

  if (result.initialize) {
    // Use the canonical "initialize" filename even if the SDK eventually
    // exposes this via the draft's `server/discover` method (SEP-2575) — see
    // CANONICAL_SNAPSHOT_NAMES. The initialize snapshot omits protocolVersion
    // and capabilities.experimental from the diff body; the reporter surfaces
    // protocol-version changes via a separate banner.
    files.set(
      CANONICAL_SNAPSHOT_NAMES.initialize,
      JSON.stringify(normalizeInitializeForDiff(result.initialize), null, 2)
    );
  }
  if (result.instructions) {
    files.set("instructions", result.instructions);
  }
  if (result.tools) {
    files.set(
      CANONICAL_SNAPSHOT_NAMES.tools,
      JSON.stringify(normalizeProbeResult(result.tools, { stripCacheHints: true }), null, 2)
    );
  }
  if (result.prompts) {
    files.set(
      CANONICAL_SNAPSHOT_NAMES.prompts,
      JSON.stringify(normalizeProbeResult(result.prompts, { stripCacheHints: true }), null, 2)
    );
  }
  if (result.resources) {
    files.set(
      CANONICAL_SNAPSHOT_NAMES.resources,
      JSON.stringify(normalizeProbeResult(result.resources, { stripCacheHints: true }), null, 2)
    );
  }
  if (result.resourceTemplates) {
    files.set(
      CANONICAL_SNAPSHOT_NAMES.resourceTemplates,
      JSON.stringify(
        normalizeProbeResult(result.resourceTemplates, { stripCacheHints: true }),
        null,
        2
      )
    );
  }

  for (const [name, response] of result.customResponses.entries()) {
    files.set(`custom_${name}`, JSON.stringify(normalizeProbeResult(response), null, 2));
  }

  return files;
}
