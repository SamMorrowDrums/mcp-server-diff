/**
 * JSON values accepted by MCP capability declarations.
 */
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

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
export const DEFAULT_CLIENT_CAPABILITIES: Readonly<ClientCapabilities> = Object.freeze({
  roots: Object.freeze({}),
  sampling: Object.freeze({
    context: Object.freeze({}),
    tools: Object.freeze({}),
  }),
  elicitation: Object.freeze({
    form: Object.freeze({}),
    url: Object.freeze({}),
  }),
});

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function cloneCapabilities(capabilities: ClientCapabilities): ClientCapabilities {
  return structuredClone(capabilities);
}

/**
 * Validate a programmatic capability object. Top-level capability values must
 * be JSON objects, matching the MCP capability schema's open-set contract.
 */
export function validateClientCapabilities(
  value: unknown,
  source = "client capabilities"
): ClientCapabilities {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new Error(`${source} must be a JSON object`);
  }

  for (const [name, capability] of Object.entries(value)) {
    if (
      typeof capability !== "object" ||
      capability === null ||
      Array.isArray(capability) ||
      (Object.getPrototypeOf(capability) !== Object.prototype &&
        Object.getPrototypeOf(capability) !== null) ||
      !isJsonValue(capability)
    ) {
      throw new Error(`${source}.${name} must be a JSON object`);
    }
  }

  return cloneCapabilities(value as ClientCapabilities);
}

/**
 * Parse a JSON capability declaration. Empty input selects the standard core
 * discovery profile; any provided object replaces that profile completely.
 */
export function parseClientCapabilities(
  input: string | undefined,
  source = "client capabilities"
): ClientCapabilities {
  if (!input || input.trim() === "") {
    return cloneCapabilities(DEFAULT_CLIENT_CAPABILITIES as ClientCapabilities);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new Error(`${source} must be valid JSON: ${error}`, { cause: error });
  }
  return validateClientCapabilities(parsed, source);
}

export function resolveClientCapabilities(capabilities?: ClientCapabilities): ClientCapabilities {
  return capabilities === undefined
    ? cloneCapabilities(DEFAULT_CLIENT_CAPABILITIES as ClientCapabilities)
    : validateClientCapabilities(capabilities);
}
