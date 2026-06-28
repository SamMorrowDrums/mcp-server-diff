/**
 * MCP Server Probe
 *
 * Probes an MCP server and collects capability snapshots.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
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
 * Stateless probe client identity. Sent as
 * `_meta["io.modelcontextprotocol/clientInfo"]` on every stateless request
 * per SEP-2243 (reserved `_meta` keys on the stateless path).
 */
const PROBE_CLIENT_INFO = {
  name: "mcp-server-diff-probe",
  version: "3.0",
} as const;

/**
 * Protocol version we advertise on the stateless `server/discover` path. The
 * server will negotiate down via the returned `supportedVersions` array if
 * needed; we capture `supportedVersions[0]` (the server's newest) as the
 * negotiated version for the snapshot banner.
 */
const STATELESS_PROBE_PROTOCOL_VERSION = "2026-07-28";

/**
 * Build the reserved `_meta` block that every stateless request's `params`
 * must carry per SEP-2243. Omitting any of these three keys causes the
 * server to reject the request with -32602.
 */
function buildStatelessReservedMeta(protocolVersion: string): Record<string, unknown> {
  return {
    "io.modelcontextprotocol/protocolVersion": protocolVersion,
    "io.modelcontextprotocol/clientInfo": { ...PROBE_CLIENT_INFO },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
}

/**
 * Discover response shape (just the fields we consume). The server may
 * include additional fields (ttlMs, cacheScope, _meta) which we keep on
 * the snapshot via the InitializeInfo mapping and let normalization handle.
 */
interface DiscoverResult {
  supportedVersions?: string[];
  capabilities?: Record<string, unknown>;
  serverInfo?: { name?: string; version?: string; [k: string]: unknown };
  instructions?: string;
  [k: string]: unknown;
}

/**
 * Minimal stateless JSON-RPC connection. The HTTP and stdio paths produce
 * conforming instances; the rest of the discover probe is transport-agnostic.
 */
interface StatelessConnection {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

/**
 * Parse a single SSE frame as emitted by the streamable-HTTP MCP server
 * (`event: message\ndata: {json}\n\n`). The MCP stateless path uses
 * one-frame-then-close responses, so we just concatenate all `data:` lines
 * and parse the result as JSON.
 */
function parseSingleSseFrame(text: string): string {
  const dataLines: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.startsWith("data:")) {
      dataLines.push(rawLine.slice(5).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) {
    throw new Error(
      `Expected SSE data frame, got: ${text.length > 200 ? text.slice(0, 200) + "…" : text}`
    );
  }
  return dataLines.join("\n");
}

/**
 * JSON-RPC error envelope returned by stateless responses. We pass these
 * through as Error objects so the orchestrator can decide whether they
 * indicate "not supported, fall back" or a real probe failure.
 */
class JsonRpcRemoteError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown
  ) {
    super(`JSON-RPC error ${code}: ${message}`);
    this.name = "JsonRpcRemoteError";
  }
}

/**
 * Open a stateless HTTP connection to an MCP server. Each request POSTs to
 * the server URL with the SEP-2243 headers (MCP-Protocol-Version, Mcp-Method)
 * and required reserved `_meta`. Responses come back as a single SSE frame
 * with Content-Type: text/event-stream — we parse the `data:` line as JSON.
 */
function openStatelessHttp(
  url: string,
  baseHeaders: Record<string, string>,
  protocolVersion: string
): StatelessConnection {
  let nextId = 1;
  const reservedMeta = buildStatelessReservedMeta(protocolVersion);
  return {
    async request(method, params) {
      const id = nextId++;
      const mergedParams: Record<string, unknown> = { ...(params ?? {}) };
      mergedParams._meta = {
        ...(typeof mergedParams._meta === "object" && mergedParams._meta !== null
          ? (mergedParams._meta as Record<string, unknown>)
          : {}),
        ...reservedMeta,
      };
      const body = JSON.stringify({ jsonrpc: "2.0", id, method, params: mergedParams });
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          ...baseHeaders,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": protocolVersion,
          "Mcp-Method": method,
        },
        body,
      });
      const rawBody = await resp.text();
      if (!resp.ok) {
        // v1.6.1-style "no discover handler" returns HTTP 400 text/plain
        // ("Bad Request: Unsupported protocol version …" or
        // "JSON RPC not handled …"). Surface as a plain Error so the
        // orchestrator falls back to the SDK initialize path.
        throw new Error(`HTTP ${resp.status}: ${rawBody.slice(0, 300)}`);
      }
      const contentType = resp.headers.get("content-type") ?? "";
      const json = contentType.includes("text/event-stream")
        ? parseSingleSseFrame(rawBody)
        : rawBody;
      const parsed = JSON.parse(json) as {
        result?: unknown;
        error?: { code: number; message: string; data?: unknown };
      };
      if (parsed.error) {
        throw new JsonRpcRemoteError(parsed.error.code, parsed.error.message, parsed.error.data);
      }
      return parsed.result;
    },
    async close() {
      // fetch has no persistent connection state to release.
    },
  };
}

/**
 * Open a stateless stdio connection to an MCP server. We spawn the child
 * process, write line-delimited JSON-RPC to stdin, and read line-delimited
 * JSON-RPC responses from stdout, correlating by `id`. There are no
 * SEP-2243 HTTP headers over stdio — only the reserved `_meta` on params.
 */
function openStatelessStdio(
  command: string,
  args: string[],
  env: Record<string, string>,
  workingDir: string | undefined,
  protocolVersion: string
): StatelessConnection {
  const child = spawn(command, args, {
    env,
    cwd: workingDir,
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  // Surface stderr for debuggability without spamming on healthy probes.
  child.stderr.on("data", (chunk: Buffer) => {
    log.info(`  [stdio stderr] ${chunk.toString("utf8").trimEnd()}`);
  });
  const rl: ReadlineInterface = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();
  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: { id?: number; result?: unknown; error?: { code: number; message: string } };
    try {
      msg = JSON.parse(trimmed);
    } catch {
      // Servers sometimes log to stdout before the JSON-RPC stream starts —
      // ignore non-JSON lines rather than rejecting outstanding requests.
      return;
    }
    if (typeof msg.id !== "number") return;
    const handler = pending.get(msg.id);
    if (!handler) return;
    pending.delete(msg.id);
    if (msg.error) {
      handler.reject(new JsonRpcRemoteError(msg.error.code, msg.error.message));
    } else {
      handler.resolve(msg.result);
    }
  });
  child.on("error", (err: Error) => {
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
  });
  child.on("exit", (code: number | null) => {
    const err = new Error(`stdio child exited prematurely with code ${code}`);
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
  });

  let nextId = 1;
  const reservedMeta = buildStatelessReservedMeta(protocolVersion);
  return {
    request(method, params) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const mergedParams: Record<string, unknown> = { ...(params ?? {}) };
        mergedParams._meta = {
          ...(typeof mergedParams._meta === "object" && mergedParams._meta !== null
            ? (mergedParams._meta as Record<string, unknown>)
            : {}),
          ...reservedMeta,
        };
        const line = JSON.stringify({ jsonrpc: "2.0", id, method, params: mergedParams }) + "\n";
        pending.set(id, { resolve, reject });
        child.stdin.write(line, (err: Error | null | undefined) => {
          if (err) {
            pending.delete(id);
            reject(err);
          }
        });
      });
    },
    async close() {
      try {
        child.stdin.end();
      } catch {
        // ignore
      }
      try {
        rl.close();
      } catch {
        // ignore
      }
      try {
        child.kill();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * Check if an error is "Method not found" (-32601)
 */
function isMethodNotFound(error: unknown): boolean {
  if (error instanceof JsonRpcRemoteError) return error.code === -32601;
  const errorStr = String(error);
  return errorStr.includes("-32601") || errorStr.includes("Method not found");
}

/**
 * Probes an MCP server and returns capability snapshots.
 *
 * Tries the stateless `server/discover` path first (SEP-2575 / SEP-2243) so
 * a server that supports the new spec is probed at its own newest spec
 * version — the honest "what does this server actually expose right now"
 * picture. On any failure to discover (HTTP 400, JSON-RPC -32601, missing
 * `supportedVersions`, parse error, …) we fall back to the legacy SDK-driven
 * `initialize` handshake, which is what every pre-2026 server supports.
 *
 * This means an upgrade like go-sdk v1.6.1 → v1.7.0-pre.1 produces an
 * "old base probed via initialize / new branch probed via discover" diff
 * rather than silently negotiating both sides down onto initialize.
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

  // First, try the stateless discover path. If it succeeds we get the new
  // spec's honest surface. If it fails for any reason we fall back to the
  // legacy SDK initialize path on a fresh client.
  const discoverOutcome = await probeViaDiscover(options, result);
  if (discoverOutcome === "ok") {
    return result;
  }
  log.info(`  server/discover not supported (${discoverOutcome}); falling back to initialize`);
  await probeViaInitialize(options, result);
  return result;
}

/**
 * Attempt to probe via the stateless `server/discover` path. Populates
 * `result` in place and returns "ok" on success, or a short reason string
 * when the orchestrator should fall back to the initialize path.
 */
async function probeViaDiscover(
  options: ProbeOptions,
  result: ProbeResult
): Promise<"ok" | string> {
  let connection: StatelessConnection;
  try {
    if (options.transport === "stdio") {
      if (!options.command) return "stdio command missing";
      log.info(
        `  Probing via server/discover (stdio): ${options.command} ${(options.args || []).join(" ")}`
      );
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) env[key] = value;
      }
      for (const [key, value] of Object.entries(options.envVars || {})) env[key] = value;
      connection = openStatelessStdio(
        options.command,
        options.args || [],
        env,
        options.workingDir,
        STATELESS_PROBE_PROTOCOL_VERSION
      );
    } else {
      if (!options.url) return "http url missing";
      log.info(`  Probing via server/discover (http): ${options.url}`);
      connection = openStatelessHttp(
        options.url,
        options.headers ?? {},
        STATELESS_PROBE_PROTOCOL_VERSION
      );
    }
  } catch (err) {
    return `connection open failed: ${err}`;
  }

  try {
    let discoverResult: DiscoverResult;
    try {
      discoverResult = (await connection.request("server/discover")) as DiscoverResult;
    } catch (err) {
      // Any failure on discover — HTTP 400 text/plain (v1.6.1 base),
      // -32601 method-not-found, parse errors — means we should fall back.
      await connection.close();
      return `discover request failed: ${err}`;
    }

    // Must look like a real DiscoverResult. Servers that don't speak the new
    // spec sometimes echo back unrelated shapes; treat anything without
    // `supportedVersions` as "not supported".
    if (
      !discoverResult ||
      typeof discoverResult !== "object" ||
      !Array.isArray(discoverResult.supportedVersions) ||
      discoverResult.supportedVersions.length === 0
    ) {
      await connection.close();
      return "discover response missing supportedVersions";
    }

    // The server's newest spec version is what we negotiated against.
    const negotiatedProtocolVersion = discoverResult.supportedVersions[0];
    log.info(`  server/discover succeeded; negotiated ${negotiatedProtocolVersion}`);

    // Map the discover result into the existing `initialize` slot. The
    // canonical snapshot filename is "initialize" (see
    // CANONICAL_SNAPSHOT_NAMES) so a server that moves from initialize to
    // discover shows as a content diff on one file, not remove+add.
    const { supportedVersions: _ignoredSupported, ...discoverRest } = discoverResult;
    result.initialize = {
      ...discoverRest,
      protocolVersion: negotiatedProtocolVersion,
      // serverInfo / capabilities flow through verbatim. Cache hints
      // (ttlMs, cacheScope) ride along too and are stripped at snapshot
      // time by normalizeInitializeForDiff.
    } as InitializeInfo;

    // Important: do NOT synthesize `instructions` if discover omits it.
    // The discover-omits-instructions-vs-initialize-emits-instructions
    // regression in go-sdk v1.7.0-pre.1 is a real public-interface change
    // we want the diff to surface, not hide.
    if (typeof discoverResult.instructions === "string" && discoverResult.instructions) {
      result.instructions = discoverResult.instructions;
      log.info(`  Got server instructions (${result.instructions.length} chars)`);
    }

    const capabilities = (discoverResult.capabilities ?? {}) as Record<string, unknown>;

    if (capabilities.tools) {
      try {
        const toolsResult = (await connection.request("tools/list")) as ToolsResult;
        result.tools = toolsResult;
        log.info(`  Listed ${toolsResult.tools.length} tools`);
      } catch (err) {
        if (isMethodNotFound(err)) log.info("  Server does not implement tools/list");
        else log.warning(`  Failed to list tools: ${err}`);
      }
    } else {
      log.info("  Server does not support tools");
    }

    if (capabilities.prompts) {
      try {
        const promptsResult = (await connection.request("prompts/list")) as PromptsResult;
        result.prompts = promptsResult;
        log.info(`  Listed ${promptsResult.prompts.length} prompts`);
      } catch (err) {
        if (isMethodNotFound(err)) log.info("  Server does not implement prompts/list");
        else log.warning(`  Failed to list prompts: ${err}`);
      }
    } else {
      log.info("  Server does not support prompts");
    }

    if (capabilities.resources) {
      try {
        const resourcesResult = (await connection.request("resources/list")) as ResourcesResult;
        result.resources = resourcesResult;
        log.info(`  Listed ${resourcesResult.resources.length} resources`);
      } catch (err) {
        if (isMethodNotFound(err)) log.info("  Server does not implement resources/list");
        else log.warning(`  Failed to list resources: ${err}`);
      }
      try {
        const templatesResult = (await connection.request(
          "resources/templates/list"
        )) as ResourceTemplatesResult;
        result.resourceTemplates = templatesResult;
        log.info(`  Listed ${templatesResult.resourceTemplates.length} resource templates`);
      } catch (err) {
        if (isMethodNotFound(err)) log.info("  Server does not implement resources/templates/list");
        else log.warning(`  Failed to list resource templates: ${err}`);
      }
    } else {
      log.info("  Server does not support resources");
    }

    if (options.customMessages && options.customMessages.length > 0) {
      for (const customMsg of options.customMessages) {
        try {
          const method = (customMsg.message as { method?: string }).method;
          if (typeof method !== "string") {
            log.warning(`  Custom message '${customMsg.name}' has no method, skipping`);
            continue;
          }
          const params = (customMsg.message as { params?: Record<string, unknown> }).params;
          const response = await connection.request(method, params);
          result.customResponses.set(customMsg.name, response);
          log.info(`  Custom message '${customMsg.name}' successful`);
        } catch (err) {
          log.warning(`  Custom message '${customMsg.name}' failed: ${err}`);
        }
      }
    }

    log.info("  Probe complete (discover path)");
    await connection.close();
    return "ok";
  } catch (err) {
    await connection.close();
    result.error = String(err);
    log.error(`  Error during stateless probe: ${err}`);
    // Don't fall back if discover *itself* succeeded — that means the
    // server does speak the new spec and a subsequent failure is a real
    // probe error, not a "not supported, fall back" signal.
    return "ok";
  }
}

/**
 * Probe via the legacy SDK `initialize` handshake. This is the fallback for
 * servers that don't yet implement `server/discover` (every pre-2026 SDK
 * release). Caps negotiated version at the SDK's `LATEST_PROTOCOL_VERSION`.
 */
async function probeViaInitialize(options: ProbeOptions, result: ProbeResult): Promise<void> {
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

    log.info("  Probe complete (initialize path)");

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
 * IMPORTANT: this is an *exact-key* denylist, not a prefix denylist. The
 * `io.modelcontextprotocol/*` namespace is reserved by the spec but is also
 * where official extensions live (MCP Apps' `io.modelcontextprotocol/ui`,
 * Tasks' `io.modelcontextprotocol/related-task`, etc.). Stripping by prefix
 * would silently delete those extension surfaces from the snapshot, which
 * defeats the entire purpose of this tool. Only the specific transport-level
 * plumbing keys go here.
 *
 * - `io.modelcontextprotocol/protocolVersion` — negotiated spec revision
 * - `io.modelcontextprotocol/clientInfo` — client's name+version
 * - `io.modelcontextprotocol/clientCapabilities` — what the client supports
 * - `io.modelcontextprotocol/subscriptionId` — per-stream subscription handle
 * - `io.modelcontextprotocol/logLevel` — runtime log level
 * - `traceparent` / `tracestate` / `baggage` — W3C trace context (OTel)
 */
const PROTOCOL_NOISE_META_KEYS = new Set<string>([
  "io.modelcontextprotocol/protocolVersion",
  "io.modelcontextprotocol/clientInfo",
  "io.modelcontextprotocol/clientCapabilities",
  "io.modelcontextprotocol/subscriptionId",
  "io.modelcontextprotocol/logLevel",
  "traceparent",
  "tracestate",
  "baggage",
]);

function isProtocolNoiseMetaKey(key: string): boolean {
  return PROTOCOL_NOISE_META_KEYS.has(key);
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
 * - Recursively cleans `_meta` objects by dropping the specific
 *   transport-plumbing keys listed in PROTOCOL_NOISE_META_KEYS (negotiated
 *   protocol version, client info/capabilities, subscription IDs, log level,
 *   plus W3C trace context). Crucially this is an *exact-key* denylist so
 *   official extension surfaces under `io.modelcontextprotocol/*` (MCP Apps'
 *   `_meta.ui`, Tasks' `_meta.io.modelcontextprotocol/related-task`, etc.)
 *   are preserved — those are exactly what this tool exists to diff. An
 *   emptied `_meta` is dropped entirely.
 *
 * Cache-hint stripping (opt-in via `stripCacheHints`):
 * - The draft spec adds `ttlMs` and `cacheScope` (CacheableResult, SEP-2461)
 *   to results of tools/list, prompts/list, resources/list, resources/read,
 *   and resources/templates/list. These are freshness/cache hints that vary
 *   run-to-run, so we strip them at the top level of each list/read result.
 *
 * Tool-annotation default stripping (always on):
 * - The MCP spec defines defaults for `ToolAnnotations` hints: `readOnlyHint`
 *   = false, `destructiveHint` = true, `idempotentHint` = false,
 *   `openWorldHint` = true. A server that omits a hint is semantically
 *   identical to one that emits the default value. Different SDK versions
 *   (or `omitempty`-toggling SDK upgrades, e.g. go-sdk v1.6→v1.7) cause one
 *   side to emit defaults and the other to omit them, producing pure
 *   cross-version churn on every tool. We canonicalize by dropping any
 *   annotation field that equals its spec default. An emptied `annotations`
 *   object is dropped entirely.
 */
const TOOL_ANNOTATION_DEFAULTS: Record<string, boolean> = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

function normalizeToolAnnotations(
  annotations: Record<string, unknown>
): Record<string, unknown> | undefined {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(annotations)) {
    if (key in TOOL_ANNOTATION_DEFAULTS && value === TOOL_ANNOTATION_DEFAULTS[key]) {
      continue;
    }
    cleaned[key] = value;
  }
  return Object.keys(cleaned).length === 0 ? undefined : cleaned;
}

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

      // Canonicalize tool `annotations`: drop hint fields that equal their
      // spec defaults so a server that emits `idempotentHint: false`
      // compares equal to one that omits it (cross-SDK / cross-spec churn).
      if (key === "annotations" && value !== null && typeof value === "object") {
        const cleaned = normalizeToolAnnotations(value as Record<string, unknown>);
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
 * Normalize an initialize (or server/discover) snapshot for diffing. Drops:
 * - `protocolVersion` (varies by negotiated version; reporter surfaces it
 *   via a separate banner)
 * - `capabilities.experimental` (churn across SDK versions)
 * - top-level `ttlMs` / `cacheScope` (CacheableResult hints, SEP-2461 — the
 *   discover handshake now carries these too, so we strip them here in
 *   addition to on each list result)
 *
 * Importantly, `instructions` and `capabilities` shape are NOT stripped —
 * those are real public-interface signals (e.g. go-sdk v1.7.0-pre.1's
 * discover-omits-instructions vs initialize-emits-instructions regression
 * has to surface, not be hidden).
 */
function normalizeInitializeForDiff(info: InitializeInfo): unknown {
  const {
    protocolVersion: _ignoredVersion,
    capabilities,
    ttlMs: _ignoredTtl,
    cacheScope: _ignoredCacheScope,
    ...rest
  } = info as InitializeInfo & {
    protocolVersion?: string;
    ttlMs?: unknown;
    cacheScope?: unknown;
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
