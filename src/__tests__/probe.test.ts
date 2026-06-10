/**
 * Tests for probe normalization
 */

import { normalizeProbeResult, probeResultToFiles } from "../probe.js";
import type { ProbeResult } from "../types.js";

describe("normalizeProbeResult", () => {
  it("sorts object keys alphabetically", () => {
    const input = { zebra: 1, apple: 2, mango: 3 };
    const result = normalizeProbeResult(input) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(["apple", "mango", "zebra"]);
  });

  it("sorts arrays of objects by name/uri", () => {
    const input = {
      tools: [{ name: "zeta" }, { name: "alpha" }, { name: "mu" }],
    };
    const result = normalizeProbeResult(input) as { tools: Array<{ name: string }> };
    expect(result.tools.map((t) => t.name)).toEqual(["alpha", "mu", "zeta"]);
  });

  it("does NOT strip ttlMs/cacheScope by default (recursive calls preserve nested data)", () => {
    const input = { ttlMs: 5000, cacheScope: "session", payload: 1 };
    const result = normalizeProbeResult(input) as Record<string, unknown>;
    expect(result.ttlMs).toBe(5000);
    expect(result.cacheScope).toBe("session");
    expect(result.payload).toBe(1);
  });

  it("strips ttlMs and cacheScope at the top level when stripCacheHints is set", () => {
    const input = {
      ttlMs: 5000,
      cacheScope: "session",
      tools: [{ name: "foo" }],
    };
    const result = normalizeProbeResult(input, { stripCacheHints: true }) as Record<
      string,
      unknown
    >;
    expect(result.ttlMs).toBeUndefined();
    expect(result.cacheScope).toBeUndefined();
    expect(result.tools).toEqual([{ name: "foo" }]);
  });

  it("does not strip nested ttlMs/cacheScope keys (only top level)", () => {
    const input = {
      tools: [{ name: "foo", ttlMs: 1000, cacheScope: "client" }],
    };
    const result = normalizeProbeResult(input, { stripCacheHints: true }) as {
      tools: Array<Record<string, unknown>>;
    };
    // ttlMs/cacheScope inside a tool description are not the CacheableResult
    // hints we're trying to strip — leave them alone.
    expect(result.tools[0].ttlMs).toBe(1000);
    expect(result.tools[0].cacheScope).toBe("client");
  });

  it("scrubs only the listed io.modelcontextprotocol/* plumbing keys from _meta", () => {
    const input = {
      tools: [
        {
          name: "search",
          _meta: {
            // Plumbing — stripped.
            "io.modelcontextprotocol/protocolVersion": "2025-11-25",
            "io.modelcontextprotocol/clientInfo": { name: "x" },
            "io.modelcontextprotocol/clientCapabilities": { sampling: {} },
            "io.modelcontextprotocol/subscriptionId": "abc",
            "io.modelcontextprotocol/logLevel": "info",
            // Extension surfaces under the reserved prefix — preserved.
            // MCP Apps (SEP-1865) puts UI metadata here.
            ui: { csp: { connectDomains: ["https://api.example.com"] } },
            "io.modelcontextprotocol/related-task": { taskId: "t1" },
            "x.acme/keep-me": true,
          },
        },
      ],
    };
    const result = normalizeProbeResult(input) as {
      tools: Array<{ _meta: Record<string, unknown> }>;
    };
    expect(result.tools[0]._meta).toEqual({
      ui: { csp: { connectDomains: ["https://api.example.com"] } },
      "io.modelcontextprotocol/related-task": { taskId: "t1" },
      "x.acme/keep-me": true,
    });
  });

  it("preserves MCP Apps _meta.ui on UI resources (SEP-1865 regression)", () => {
    // MCP Apps declares UI metadata at resource._meta.ui — including CSP
    // config, sandbox permissions, and dedicated origin. None of this is
    // protocol plumbing; all of it is the server's public surface and MUST
    // round-trip through the snapshot intact.
    const input = {
      resources: [
        {
          uri: "ui://weather-dashboard",
          name: "Weather Dashboard",
          mimeType: "text/html;profile=mcp-app",
          _meta: {
            ui: {
              csp: {
                connectDomains: ["https://api.weather.com"],
                resourceDomains: ["https://cdn.jsdelivr.net"],
              },
              permissions: { geolocation: {} },
            },
            // SDK injected this — must be stripped without taking ui with it.
            "io.modelcontextprotocol/protocolVersion": "draft",
          },
        },
      ],
    };
    const result = normalizeProbeResult(input) as {
      resources: Array<{ _meta: Record<string, unknown> }>;
    };
    expect(result.resources[0]._meta).toEqual({
      ui: {
        csp: {
          connectDomains: ["https://api.weather.com"],
          resourceDomains: ["https://cdn.jsdelivr.net"],
        },
        permissions: { geolocation: {} },
      },
    });
  });

  it("drops _meta entirely when nothing useful is left after scrubbing", () => {
    const input = {
      tools: [
        {
          name: "search",
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "draft",
            traceparent: "00-...",
          },
        },
      ],
    };
    const result = normalizeProbeResult(input) as {
      tools: Array<Record<string, unknown>>;
    };
    expect("_meta" in result.tools[0]).toBe(false);
  });

  it("scrubs W3C trace-context keys (traceparent, tracestate, baggage) from _meta", () => {
    const input = {
      _meta: {
        traceparent: "00-abc",
        tracestate: "vendor=x",
        baggage: "k=v",
        keep: "yes",
      },
    };
    const result = normalizeProbeResult(input) as { _meta: Record<string, unknown> };
    expect(result._meta).toEqual({ keep: "yes" });
  });
});

describe("probeResultToFiles cache-hint stripping", () => {
  function makeResult(overrides: Partial<ProbeResult>): ProbeResult {
    return {
      initialize: null,
      instructions: null,
      tools: null,
      prompts: null,
      resources: null,
      resourceTemplates: null,
      customResponses: new Map(),
      ...overrides,
    };
  }

  it("strips ttlMs and cacheScope from tools/list", () => {
    const result = makeResult({
      tools: {
        // Cast through unknown to allow draft-spec extras the static type doesn't model yet.
        ...{ ttlMs: 60000, cacheScope: "session" },
        tools: [{ name: "search" }],
      } as unknown as ProbeResult["tools"],
    });
    const files = probeResultToFiles(result);
    const tools = JSON.parse(files.get("tools")!);
    expect(tools.ttlMs).toBeUndefined();
    expect(tools.cacheScope).toBeUndefined();
    expect(tools.tools).toEqual([{ name: "search" }]);
  });

  it("strips ttlMs and cacheScope from prompts/list", () => {
    const result = makeResult({
      prompts: {
        ...{ ttlMs: 1, cacheScope: "client" },
        prompts: [{ name: "code-review" }],
      } as unknown as ProbeResult["prompts"],
    });
    const prompts = JSON.parse(probeResultToFiles(result).get("prompts")!);
    expect(prompts.ttlMs).toBeUndefined();
    expect(prompts.cacheScope).toBeUndefined();
  });

  it("strips ttlMs and cacheScope from resources/list", () => {
    const result = makeResult({
      resources: {
        ...{ ttlMs: 1, cacheScope: "session" },
        resources: [{ uri: "test://a", name: "a" }],
      } as unknown as ProbeResult["resources"],
    });
    const resources = JSON.parse(probeResultToFiles(result).get("resources")!);
    expect(resources.ttlMs).toBeUndefined();
    expect(resources.cacheScope).toBeUndefined();
  });

  it("strips ttlMs and cacheScope from resources/templates/list", () => {
    const result = makeResult({
      resourceTemplates: {
        ...{ ttlMs: 1, cacheScope: "session" },
        resourceTemplates: [{ uriTemplate: "test://{id}", name: "tmpl" }],
      } as unknown as ProbeResult["resourceTemplates"],
    });
    const templates = JSON.parse(probeResultToFiles(result).get("resource_templates")!);
    expect(templates.ttlMs).toBeUndefined();
    expect(templates.cacheScope).toBeUndefined();
  });

  it("strips protocolVersion and capabilities.experimental from the initialize diff body", () => {
    // protocolVersion drift is surfaced by the reporter as a banner — it must
    // not appear in the snapshot file or it would dominate every cross-spec
    // diff. capabilities.experimental is SDK churn, not public surface.
    const result = makeResult({
      initialize: {
        protocolVersion: "2025-11-25",
        serverInfo: { name: "s", version: "1" },
        capabilities: { tools: { listChanged: true }, experimental: { foo: 1 } },
      },
    });
    const init = JSON.parse(probeResultToFiles(result).get("initialize")!);
    expect(init.protocolVersion).toBeUndefined();
    expect(init.capabilities.experimental).toBeUndefined();
    expect(init.capabilities.tools).toEqual({ listChanged: true });
    expect(init.serverInfo).toEqual({ name: "s", version: "1" });
  });

  it("does NOT strip non-experimental cache hints from the initialize snapshot", () => {
    // initialize is normalized but cache hints inside capabilities (which
    // shouldn't normally appear) aren't a CacheableResult envelope.
    const result = makeResult({
      initialize: {
        serverInfo: { name: "s", version: "1" },
        capabilities: { ttlMs: 999 },
      },
    });
    const init = JSON.parse(probeResultToFiles(result).get("initialize")!);
    expect(init.capabilities.ttlMs).toBe(999);
  });
});

describe("cross-version diff cleanliness", () => {
  function makeResult(overrides: Partial<ProbeResult>): ProbeResult {
    return {
      initialize: null,
      instructions: null,
      tools: null,
      prompts: null,
      resources: null,
      resourceTemplates: null,
      customResponses: new Map(),
      ...overrides,
    };
  }

  // Simulates the same server probed under two different MCP spec revisions:
  // the base ran under 2025-11-25 with a clean envelope; the branch runs
  // under the draft, which decorates results with CacheableResult fields and
  // io.modelcontextprotocol/* _meta plumbing. The server's public surface is
  // identical — the normalized snapshots must match byte-for-byte.
  it("produces identical tools/list snapshots across spec revisions when the public surface is unchanged", () => {
    const baseResult = makeResult({
      tools: {
        tools: [
          { name: "search", description: "Find things" },
          { name: "add", description: "Add numbers" },
        ],
      },
    });

    const branchResult = makeResult({
      tools: {
        // draft-spec envelope additions
        ...{
          ttlMs: 60000,
          cacheScope: "session",
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "draft",
            "io.modelcontextprotocol/subscriptionId": "sub-123",
          },
        },
        tools: [
          {
            name: "search",
            description: "Find things",
            _meta: {
              "io.modelcontextprotocol/clientCapabilities": { sampling: {} },
              traceparent: "00-1234567890abcdef-fedcba0987654321-01",
            },
          },
          {
            name: "add",
            description: "Add numbers",
            _meta: {
              "io.modelcontextprotocol/logLevel": "info",
            },
          },
        ],
      } as unknown as ProbeResult["tools"],
    });

    const baseSnapshot = probeResultToFiles(baseResult).get("tools")!;
    const branchSnapshot = probeResultToFiles(branchResult).get("tools")!;
    expect(branchSnapshot).toBe(baseSnapshot);
  });

  it("produces identical initialize snapshots across spec revisions when only protocolVersion + experimental differ", () => {
    const baseResult = makeResult({
      initialize: {
        protocolVersion: "2025-11-25",
        serverInfo: { name: "demo", version: "1.0.0" },
        capabilities: { tools: { listChanged: true } },
      },
    });
    const branchResult = makeResult({
      initialize: {
        protocolVersion: "draft",
        serverInfo: { name: "demo", version: "1.0.0" },
        capabilities: {
          tools: { listChanged: true },
          // SDK upgrade injects experimental — not part of public surface
          experimental: { tasks: {} },
        },
      },
    });
    expect(probeResultToFiles(branchResult).get("initialize")).toBe(
      probeResultToFiles(baseResult).get("initialize")
    );
  });

  it("still flags a real change to the public surface across spec revisions", () => {
    const baseResult = makeResult({
      tools: { tools: [{ name: "search" }] },
    });
    const branchResult = makeResult({
      tools: {
        ...{ ttlMs: 60000, _meta: { "io.modelcontextprotocol/protocolVersion": "draft" } },
        tools: [{ name: "search" }, { name: "add" }],
      } as unknown as ProbeResult["tools"],
    });
    expect(probeResultToFiles(branchResult).get("tools")).not.toBe(
      probeResultToFiles(baseResult).get("tools")
    );
  });
});

describe("lossless capture of advertised tool/resource properties", () => {
  function makeResult(overrides: Partial<ProbeResult>): ProbeResult {
    return {
      initialize: null,
      instructions: null,
      tools: null,
      prompts: null,
      resources: null,
      resourceTemplates: null,
      customResponses: new Map(),
      ...overrides,
    };
  }

  // Build a single result with every spec-defined per-item field we can think
  // of (tool annotations + outputSchema + custom _meta, MCP Apps UI resource
  // with full _meta.ui, prompt arguments, resource templates) and confirm
  // every property round-trips through the snapshot. This is the regression
  // guard for "all advertised properties are effectively compared".
  it("preserves tool annotations, outputSchema, custom _meta, MCP Apps UI metadata, and resource templates", () => {
    const probe = makeResult({
      tools: {
        tools: [
          {
            name: "search",
            description: "Find things",
            inputSchema: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
            // Newer spec fields — must survive.
            annotations: {
              title: "Search the web",
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
            outputSchema: {
              type: "object",
              properties: { results: { type: "array" } },
            },
            _meta: {
              // MCP Apps tool→UI link (SEP-1865 examples wire tools to
              // ui:// resources via _meta). Must NOT be stripped.
              ui: { resource: "ui://search-results" },
              // Vendor extension under a non-reserved namespace.
              "x.acme/cost-tier": "premium",
            },
          },
        ],
      } as unknown as ProbeResult["tools"],
      prompts: {
        prompts: [
          {
            name: "code-review",
            description: "Review code",
            arguments: [{ name: "diff", description: "The diff", required: true }],
            _meta: { "x.acme/version": 2 },
          },
        ],
      } as unknown as ProbeResult["prompts"],
      resources: {
        resources: [
          {
            uri: "ui://weather-dashboard",
            name: "Weather Dashboard",
            description: "Interactive weather visualization",
            mimeType: "text/html;profile=mcp-app",
            // Full MCP Apps _meta.ui shape from SEP-1865 §UI Resource Format.
            _meta: {
              ui: {
                csp: {
                  connectDomains: ["https://api.weather.com", "wss://realtime.service.com"],
                  resourceDomains: ["https://cdn.jsdelivr.net", "https://*.cloudflare.com"],
                  frameDomains: ["https://www.youtube.com"],
                  baseUriDomains: ["https://cdn.example.com"],
                },
                permissions: {
                  camera: {},
                  microphone: {},
                  geolocation: {},
                  clipboardWrite: {},
                },
              },
            },
          },
        ],
      } as unknown as ProbeResult["resources"],
      resourceTemplates: {
        resourceTemplates: [
          {
            uriTemplate: "weather://{city}",
            name: "City weather",
            description: "Weather for a city",
            mimeType: "application/json",
            _meta: { "x.acme/cache-ttl": 60 },
          },
        ],
      } as unknown as ProbeResult["resourceTemplates"],
    });

    const files = probeResultToFiles(probe);

    const tool = JSON.parse(files.get("tools")!).tools[0];
    expect(tool.annotations).toEqual({
      title: "Search the web",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(tool.outputSchema).toEqual({
      type: "object",
      properties: { results: { type: "array" } },
    });
    expect(tool._meta).toEqual({
      ui: { resource: "ui://search-results" },
      "x.acme/cost-tier": "premium",
    });

    const prompt = JSON.parse(files.get("prompts")!).prompts[0];
    expect(prompt.arguments).toEqual([{ description: "The diff", name: "diff", required: true }]);
    expect(prompt._meta).toEqual({ "x.acme/version": 2 });

    const uiResource = JSON.parse(files.get("resources")!).resources[0];
    expect(uiResource.mimeType).toBe("text/html;profile=mcp-app");
    expect(uiResource._meta.ui.csp.connectDomains).toEqual([
      "https://api.weather.com",
      "wss://realtime.service.com",
    ]);
    expect(uiResource._meta.ui.permissions).toEqual({
      camera: {},
      microphone: {},
      geolocation: {},
      clipboardWrite: {},
    });

    const template = JSON.parse(files.get("resource_templates")!).resourceTemplates[0];
    expect(template.uriTemplate).toBe("weather://{city}");
    expect(template._meta).toEqual({ "x.acme/cache-ttl": 60 });
  });
});
