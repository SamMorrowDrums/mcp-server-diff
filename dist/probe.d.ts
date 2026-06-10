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
 */
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
