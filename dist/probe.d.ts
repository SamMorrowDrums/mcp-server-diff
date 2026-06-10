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
 * Probes an MCP server and returns capability snapshots
 */
export declare function probeServer(options: ProbeOptions): Promise<ProbeResult>;
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
 * Cache-hint stripping:
 * - The draft spec adds `ttlMs` and `cacheScope` (CacheableResult) to
 *   results of tools/list, prompts/list, resources/list, resources/read,
 *   and resources/templates/list. These are freshness/cache hints that vary
 *   run-to-run and would produce diff noise, so we strip them at the top
 *   level of each normalized result. Pass `stripCacheHints: true` for the
 *   top-level call on a list/read result.
 */
export declare function normalizeProbeResult(result: unknown, options?: {
    stripCacheHints?: boolean;
}): unknown;
/**
 * Convert probe result to a map of endpoint -> JSON string
 */
export declare function probeResultToFiles(result: ProbeResult): Map<string, string>;
