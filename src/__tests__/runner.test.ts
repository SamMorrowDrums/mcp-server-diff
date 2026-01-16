import { parseHeaders, parseConfigurations } from "../runner.js";
import { normalizeProbeResult } from "../probe.js";

describe("parseHeaders", () => {
  it("returns empty object for empty input", () => {
    expect(parseHeaders("")).toEqual({});
    expect(parseHeaders("  ")).toEqual({});
  });

  it("parses JSON object format", () => {
    const input = '{"Authorization": "Bearer token123", "X-Custom": "value"}';
    const result = parseHeaders(input);
    expect(result).toEqual({
      Authorization: "Bearer token123",
      "X-Custom": "value",
    });
  });

  it("parses colon-separated header format", () => {
    const input = `Authorization: Bearer token123
X-Custom: value`;
    const result = parseHeaders(input);
    expect(result).toEqual({
      Authorization: "Bearer token123",
      "X-Custom": "value",
    });
  });

  it("handles headers with colons in values", () => {
    const input = "X-Timestamp: 2024:01:15:12:00:00";
    const result = parseHeaders(input);
    expect(result).toEqual({
      "X-Timestamp": "2024:01:15:12:00:00",
    });
  });

  it("skips empty lines in colon-separated format", () => {
    const input = `Authorization: Bearer token

X-Custom: value`;
    const result = parseHeaders(input);
    expect(result).toEqual({
      Authorization: "Bearer token",
      "X-Custom": "value",
    });
  });

  it("trims whitespace from header names and values", () => {
    const input = "  Authorization  :   Bearer token  ";
    const result = parseHeaders(input);
    expect(result).toEqual({
      Authorization: "Bearer token",
    });
  });

  it("returns empty object for invalid JSON that doesn't look like headers", () => {
    const input = "not valid headers or json";
    const result = parseHeaders(input);
    expect(result).toEqual({});
  });
});

describe("parseConfigurations", () => {
  const defaultTransport = "stdio" as const;
  const defaultCommand = "node server.js";
  const defaultUrl = "http://localhost:3000/mcp";

  it("returns default config when input is empty", () => {
    const result = parseConfigurations("", defaultTransport, defaultCommand, defaultUrl);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "default",
      transport: "stdio",
      start_command: "node server.js",
      server_url: undefined,
    });
  });

  it("returns default config when input is empty array", () => {
    const result = parseConfigurations("[]", defaultTransport, defaultCommand, defaultUrl);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("default");
  });

  it("applies transport default to configs without transport", () => {
    const input = JSON.stringify([
      { name: "test1", args: "--read-only" },
      { name: "test2", args: "--dynamic" },
    ]);
    const result = parseConfigurations(input, defaultTransport, defaultCommand, defaultUrl);

    expect(result).toHaveLength(2);
    expect(result[0].transport).toBe("stdio");
    expect(result[1].transport).toBe("stdio");
  });

  it("applies start_command default to stdio configs without start_command", () => {
    const input = JSON.stringify([
      { name: "test1", args: "--read-only" },
      { name: "test2", start_command: "custom command" },
    ]);
    const result = parseConfigurations(input, defaultTransport, defaultCommand, defaultUrl);

    expect(result[0].start_command).toBe("node server.js");
    expect(result[1].start_command).toBe("custom command");
  });

  it("applies server_url default to http configs without server_url", () => {
    const input = JSON.stringify([
      { name: "test1", transport: "streamable-http" },
      { name: "test2", transport: "streamable-http", server_url: "http://custom:8080/mcp" },
    ]);
    const result = parseConfigurations(input, defaultTransport, defaultCommand, defaultUrl);

    expect(result[0].server_url).toBe("http://localhost:3000/mcp");
    expect(result[1].server_url).toBe("http://custom:8080/mcp");
  });

  it("preserves explicit transport values", () => {
    const input = JSON.stringify([
      { name: "stdio-test", transport: "stdio", start_command: "node server.js" },
      { name: "http-test", transport: "streamable-http", server_url: "http://localhost:3000" },
    ]);
    const result = parseConfigurations(input, defaultTransport, defaultCommand, defaultUrl);

    expect(result[0].transport).toBe("stdio");
    expect(result[1].transport).toBe("streamable-http");
  });

  it("handles github-mcp-server style configs (name + args only)", () => {
    const input = JSON.stringify([
      { name: "default", args: "" },
      { name: "read-only", args: "--read-only" },
      { name: "dynamic-toolsets", args: "--dynamic-toolsets" },
    ]);
    const result = parseConfigurations(input, "stdio", "go run ./cmd/server stdio", defaultUrl);

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      name: "default",
      transport: "stdio",
      start_command: "go run ./cmd/server stdio",
    });
    expect(result[1]).toMatchObject({
      name: "read-only",
      transport: "stdio",
      start_command: "go run ./cmd/server stdio",
      args: "--read-only",
    });
  });
});

describe("normalizeProbeResult", () => {
  it("returns null/undefined as-is", () => {
    expect(normalizeProbeResult(null)).toBe(null);
    expect(normalizeProbeResult(undefined)).toBe(undefined);
  });

  it("returns primitives as-is", () => {
    expect(normalizeProbeResult("hello")).toBe("hello");
    expect(normalizeProbeResult(123)).toBe(123);
    expect(normalizeProbeResult(true)).toBe(true);
  });

  it("sorts object keys alphabetically", () => {
    const input = { zebra: 1, apple: 2, mango: 3 };
    const result = normalizeProbeResult(input);
    const keys = Object.keys(result as object);
    expect(keys).toEqual(["apple", "mango", "zebra"]);
  });

  it("sorts nested object keys", () => {
    const input = {
      outer: {
        zebra: 1,
        apple: 2,
      },
    };
    const result = normalizeProbeResult(input) as { outer: object };
    const nestedKeys = Object.keys(result.outer);
    expect(nestedKeys).toEqual(["apple", "zebra"]);
  });

  it("sorts arrays of objects by 'name' field (tools)", () => {
    const input = {
      tools: [
        { name: "zebra_tool", description: "Z tool" },
        { name: "apple_tool", description: "A tool" },
        { name: "mango_tool", description: "M tool" },
      ],
    };
    const result = normalizeProbeResult(input) as { tools: Array<{ name: string }> };
    expect(result.tools[0].name).toBe("apple_tool");
    expect(result.tools[1].name).toBe("mango_tool");
    expect(result.tools[2].name).toBe("zebra_tool");
  });

  it("sorts arrays of objects by 'uri' field (resources)", () => {
    const input = {
      resources: [
        { uri: "file:///z.txt", name: "Z" },
        { uri: "file:///a.txt", name: "A" },
        { uri: "file:///m.txt", name: "M" },
      ],
    };
    const result = normalizeProbeResult(input) as { resources: Array<{ uri: string }> };
    expect(result.resources[0].uri).toBe("file:///a.txt");
    expect(result.resources[1].uri).toBe("file:///m.txt");
    expect(result.resources[2].uri).toBe("file:///z.txt");
  });

  it("sorts arrays of objects by 'uriTemplate' field (resource templates)", () => {
    const input = {
      resourceTemplates: [
        { uriTemplate: "file:///{z}", name: "Z Template" },
        { uriTemplate: "file:///{a}", name: "A Template" },
      ],
    };
    const result = normalizeProbeResult(input) as {
      resourceTemplates: Array<{ uriTemplate: string }>;
    };
    expect(result.resourceTemplates[0].uriTemplate).toBe("file:///{a}");
    expect(result.resourceTemplates[1].uriTemplate).toBe("file:///{z}");
  });

  it("sorts arrays of objects by 'type' field (content items)", () => {
    const input = {
      content: [
        { type: "text", text: "Hello" },
        { type: "image", data: "base64..." },
        { type: "audio", data: "base64..." },
      ],
    };
    const result = normalizeProbeResult(input) as { content: Array<{ type: string }> };
    expect(result.content[0].type).toBe("audio");
    expect(result.content[1].type).toBe("image");
    expect(result.content[2].type).toBe("text");
  });

  it("sorts prompt arguments by name", () => {
    const input = {
      prompts: [
        {
          name: "test-prompt",
          arguments: [
            { name: "zebra_arg", required: true },
            { name: "apple_arg", required: false },
            { name: "mango_arg", required: true },
          ],
        },
      ],
    };
    const result = normalizeProbeResult(input) as {
      prompts: Array<{ arguments: Array<{ name: string }> }>;
    };
    const args = result.prompts[0].arguments;
    expect(args[0].name).toBe("apple_arg");
    expect(args[1].name).toBe("mango_arg");
    expect(args[2].name).toBe("zebra_arg");
  });

  it("sorts tool inputSchema properties deterministically", () => {
    const input = {
      tools: [
        {
          name: "my_tool",
          inputSchema: {
            type: "object",
            properties: {
              zebra: { type: "string" },
              apple: { type: "number" },
            },
            required: ["zebra", "apple"],
          },
        },
      ],
    };
    const result = normalizeProbeResult(input) as {
      tools: Array<{ inputSchema: { properties: Record<string, unknown>; required: string[] } }>;
    };
    const propKeys = Object.keys(result.tools[0].inputSchema.properties);
    expect(propKeys).toEqual(["apple", "zebra"]);
    // Required array should also be sorted
    expect(result.tools[0].inputSchema.required).toEqual(["apple", "zebra"]);
  });

  it("handles embedded JSON in text fields", () => {
    const embeddedJson = JSON.stringify({ zebra: 1, apple: 2 });
    const input = {
      content: [{ type: "text", text: embeddedJson }],
    };
    const result = normalizeProbeResult(input) as {
      content: Array<{ text: string }>;
    };
    // The embedded JSON should be normalized (keys sorted)
    const parsed = JSON.parse(result.content[0].text);
    const keys = Object.keys(parsed);
    expect(keys).toEqual(["apple", "zebra"]);
  });

  it("handles embedded JSON arrays in text fields", () => {
    const embeddedJson = JSON.stringify([{ name: "zebra" }, { name: "apple" }]);
    const input = {
      content: [{ type: "text", text: embeddedJson }],
    };
    const result = normalizeProbeResult(input) as {
      content: Array<{ text: string }>;
    };
    // The embedded JSON array should be normalized and sorted
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed[0].name).toBe("apple");
    expect(parsed[1].name).toBe("zebra");
  });

  it("leaves non-JSON text fields unchanged", () => {
    const input = {
      content: [{ type: "text", text: "Hello, world!" }],
    };
    const result = normalizeProbeResult(input) as {
      content: Array<{ text: string }>;
    };
    expect(result.content[0].text).toBe("Hello, world!");
  });

  it("produces consistent JSON output regardless of input key order", () => {
    const input1 = { z: 1, a: 2, m: { x: 1, b: 2 } };
    const input2 = { a: 2, m: { b: 2, x: 1 }, z: 1 };

    const result1 = JSON.stringify(normalizeProbeResult(input1));
    const result2 = JSON.stringify(normalizeProbeResult(input2));

    expect(result1).toBe(result2);
  });

  it("produces consistent JSON for complete MCP responses regardless of ordering", () => {
    // Simulate two identical tool responses with different initial ordering
    const response1 = {
      tools: [
        {
          name: "get_user",
          description: "Gets user info",
          inputSchema: {
            type: "object",
            required: ["id", "name"],
            properties: { name: { type: "string" }, id: { type: "number" } },
          },
        },
        {
          name: "add_numbers",
          description: "Adds two numbers",
          inputSchema: {
            type: "object",
            properties: { a: { type: "number" }, b: { type: "number" } },
            required: ["a", "b"],
          },
        },
      ],
    };

    const response2 = {
      tools: [
        {
          description: "Adds two numbers",
          name: "add_numbers",
          inputSchema: {
            required: ["a", "b"],
            type: "object",
            properties: { b: { type: "number" }, a: { type: "number" } },
          },
        },
        {
          inputSchema: {
            properties: { id: { type: "number" }, name: { type: "string" } },
            required: ["name", "id"],
            type: "object",
          },
          description: "Gets user info",
          name: "get_user",
        },
      ],
    };

    const normalized1 = JSON.stringify(normalizeProbeResult(response1), null, 2);
    const normalized2 = JSON.stringify(normalizeProbeResult(response2), null, 2);

    expect(normalized1).toBe(normalized2);

    // Verify the order is deterministic (add_numbers before get_user)
    const parsed = JSON.parse(normalized1) as { tools: Array<{ name: string }> };
    expect(parsed.tools[0].name).toBe("add_numbers");
    expect(parsed.tools[1].name).toBe("get_user");
  });

  it("is idempotent - normalizing twice produces same result", () => {
    const input = {
      tools: [
        { name: "z_tool", description: "Last" },
        { name: "a_tool", description: "First" },
      ],
      resources: [
        { uri: "file:///z.txt" },
        { uri: "file:///a.txt" },
      ],
    };

    const once = normalizeProbeResult(input);
    const twice = normalizeProbeResult(once);

    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });

  it("handles arrays without identifiable sort keys", () => {
    const input = {
      data: [3, 1, 4, 1, 5, 9, 2, 6],
    };
    const result = normalizeProbeResult(input) as { data: number[] };
    // Numbers sorted as strings
    expect(result.data).toEqual([1, 1, 2, 3, 4, 5, 6, 9]);
  });

  it("handles mixed arrays with objects lacking standard keys", () => {
    const input = {
      items: [
        { value: 3, label: "three" },
        { value: 1, label: "one" },
      ],
    };
    const result = normalizeProbeResult(input) as { items: Array<{ value: number }> };
    // Falls back to JSON string comparison
    expect(result.items[0].value).toBe(1);
    expect(result.items[1].value).toBe(3);
  });
});
