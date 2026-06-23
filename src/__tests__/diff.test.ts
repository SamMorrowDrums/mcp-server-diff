import { compareProbeResults } from "../diff.js";
import type { ProbeResult } from "../types.js";

function createProbeResult(toolDescription: string, argumentDescription: string): ProbeResult {
  return {
    initialize: {
      serverInfo: {
        name: "test-server",
        version: "1.0.0",
      },
      capabilities: {
        tools: {},
      },
    },
    instructions: null,
    tools: {
      tools: [
        {
          name: "greet",
          description: toolDescription,
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: argumentDescription,
              },
            },
            required: ["name"],
          },
        },
      ],
    },
    prompts: null,
    resources: null,
    resourceTemplates: null,
    customResponses: new Map(),
  };
}

describe("compareProbeResults", () => {
  it("reports tool description and schema description changes as tools endpoint diffs", () => {
    const baseResult = createProbeResult("Greet a user by name", "Name of the user to greet");
    const targetResult = createProbeResult(
      "Greet a user by full name",
      "Full display name of the user to greet"
    );

    const diffs = compareProbeResults(baseResult, targetResult);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].endpoint).toBe("tools");
    expect(diffs[0].diff).toContain('tools[greet].description: "Greet a user by name"');
    expect(diffs[0].diff).toContain('tools[greet].description: "Greet a user by full name"');
    expect(diffs[0].diff).toContain(
      'tools[greet].inputSchema.properties.name.description: "Name of the user to greet"'
    );
    expect(diffs[0].diff).toContain(
      'tools[greet].inputSchema.properties.name.description: "Full display name of the user to greet"'
    );
  });
});
