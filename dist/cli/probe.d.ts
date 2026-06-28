/**
 * MCP Server Probe
 *
 * Probes an MCP server and collects capability snapshots.
 */
import type { ProbeResult, CustomMessage } from "./types.js";
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
export declare function probeServer(options: ProbeOptions): Promise<ProbeResult>;
export declare function normalizeProbeResult(result: unknown, options?: {
    stripCacheHints?: boolean;
}): unknown;
/**
 * Canonical snapshot file names. Endpoint renames in the spec (e.g. the
 * draft's `initialize` → `server/discover`, SEP-2575) should be mapped here
 * so a server moving from one spec revision to another shows up as a content
 * diff on a single file, not "endpoint removed + endpoint added".
 *
 * We currently keep `initialize` as the canonical name for that snapshot;
 * the constant exists so the mapping is explicit and easy to extend.
 */
export declare const CANONICAL_SNAPSHOT_NAMES: {
    readonly initialize: "initialize";
    readonly serverDiscover: "initialize";
    readonly tools: "tools";
    readonly prompts: "prompts";
    readonly resources: "resources";
    readonly resourceTemplates: "resource_templates";
};
/**
 * Convert probe result to a map of endpoint -> JSON string
 */
export declare function probeResultToFiles(result: ProbeResult): Map<string, string>;
