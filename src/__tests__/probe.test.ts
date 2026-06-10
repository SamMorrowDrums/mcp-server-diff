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

  it("recursively scrubs io.modelcontextprotocol/* keys from _meta", () => {
    const input = {
      tools: [
        {
          name: "search",
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2025-11-25",
            "io.modelcontextprotocol/clientInfo": { name: "x" },
            "io.modelcontextprotocol/subscriptionId": "abc",
            "x.acme/keep-me": true,
          },
        },
      ],
    };
    const result = normalizeProbeResult(input) as {
      tools: Array<{ _meta: Record<string, unknown> }>;
    };
    expect(result.tools[0]._meta).toEqual({ "x.acme/keep-me": true });
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
