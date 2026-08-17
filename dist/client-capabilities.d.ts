/**
 * JSON values accepted by MCP capability declarations.
 */
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export type JsonObject = {
    [key: string]: JsonValue;
};
/**
 * MCP client capabilities are intentionally open-ended. Known core capability
 * names and vendor-defined additions both map to JSON objects.
 */
export type ClientCapabilities = Record<string, JsonObject>;
/**
 * Interface-discovery profile used when callers do not provide an override.
 *
 * This advertises every standardized core client capability in MCP 2026-07-28:
 * roots, full sampling, and both elicitation modes. It deliberately does not
 * opt into extensions such as Tasks, which have their own behavior contracts.
 */
export declare const DEFAULT_CLIENT_CAPABILITIES: Readonly<ClientCapabilities>;
/**
 * Validate a programmatic capability object. Top-level capability values must
 * be JSON objects, matching the MCP capability schema's open-set contract.
 */
export declare function validateClientCapabilities(value: unknown, source?: string): ClientCapabilities;
/**
 * Parse a JSON capability declaration. Empty input selects the standard core
 * discovery profile; any provided object replaces that profile completely.
 */
export declare function parseClientCapabilities(input: string | undefined, source?: string): ClientCapabilities;
export declare function resolveClientCapabilities(capabilities?: ClientCapabilities): ClientCapabilities;
