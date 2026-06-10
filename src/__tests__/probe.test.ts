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

  it("does NOT strip cache hints from the initialize snapshot", () => {
    // initialize is a different result shape — capabilities.extensions etc. live here
    // and we don't want to accidentally drop any fields.
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
