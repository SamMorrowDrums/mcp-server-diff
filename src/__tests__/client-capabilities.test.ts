import {
  DEFAULT_CLIENT_CAPABILITIES,
  parseClientCapabilities,
  validateClientCapabilities,
} from "../client-capabilities.js";

describe("client capabilities", () => {
  it("uses every standardized 2026-07-28 core capability by default", () => {
    expect(parseClientCapabilities("")).toEqual({
      roots: {},
      sampling: {
        context: {},
        tools: {},
      },
      elicitation: {
        form: {},
        url: {},
      },
    });
  });

  it("returns an isolated default object for each probe", () => {
    const first = parseClientCapabilities("");
    first.elicitation.form = { custom: true };

    expect(parseClientCapabilities("")).toEqual(DEFAULT_CLIENT_CAPABILITIES);
  });

  it("round-trips unknown top-level and extension capability objects", () => {
    const input = {
      elicitation: { form: { applyDefaults: true } },
      extensions: {
        "com.example/future-client": {
          version: 2,
          features: ["alpha", "beta"],
        },
      },
      "com.example/top-level": {
        enabled: true,
      },
    };

    expect(parseClientCapabilities(JSON.stringify(input))).toEqual(input);
  });

  it("allows an explicit empty object to advertise no optional capabilities", () => {
    expect(parseClientCapabilities("{}")).toEqual({});
  });

  it("rejects non-object capability values", () => {
    expect(() => validateClientCapabilities({ elicitation: true })).toThrow(
      "client capabilities.elicitation must be a JSON object"
    );
    expect(() => parseClientCapabilities("[]")).toThrow(
      "client capabilities must be a JSON object"
    );
  });
});
