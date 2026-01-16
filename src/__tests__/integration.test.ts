/**
 * Integration tests for MCP Conformance Action
 *
 * These tests actually spin up MCP servers and probe them.
 */

import { probeServer, probeResultToFiles } from "../probe.js";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";
import { jest } from "@jest/globals";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");

// Increase timeout for integration tests
jest.setTimeout(30000);

describe("Integration: stdio transport", () => {
  it("probes a real stdio MCP server", async () => {
    const result = await probeServer({
      transport: "stdio",
      command: "npx",
      args: ["tsx", path.join(FIXTURES_DIR, "stdio-server.ts")],
      workingDir: FIXTURES_DIR,
    });

    // Should not have errors
    expect(result.error).toBeUndefined();

    // Should have initialize info
    expect(result.initialize).not.toBeNull();
    expect(result.initialize?.serverInfo?.name).toBe("test-stdio-server");
    expect(result.initialize?.serverInfo?.version).toBe("1.0.0");

    // Should have tools
    expect(result.tools).not.toBeNull();
    expect(result.tools?.tools).toHaveLength(2);
    const toolNames = result.tools?.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual(["add", "greet"]);

    // Should have prompts
    expect(result.prompts).not.toBeNull();
    expect(result.prompts?.prompts).toHaveLength(1);
    expect(result.prompts?.prompts[0].name).toBe("code-review");

    // Should have resources
    expect(result.resources).not.toBeNull();
    expect(result.resources?.resources).toHaveLength(1);
    expect(result.resources?.resources[0].uri).toBe("test://readme");
  });

  it("handles probe errors gracefully", async () => {
    const result = await probeServer({
      transport: "stdio",
      command: "node",
      args: ["-e", "console.log('not an mcp server'); process.exit(1)"],
      workingDir: FIXTURES_DIR,
    });

    // Should have an error
    expect(result.error).toBeDefined();
  });

  it("returns error for non-existent command", async () => {
    const result = await probeServer({
      transport: "stdio",
      command: "non-existent-command-12345",
      args: [],
      workingDir: FIXTURES_DIR,
    });

    // Should have an error
    expect(result.error).toBeDefined();
  });
});

describe("Integration: streamable-http transport", () => {
  let serverProcess: ChildProcess | null = null;
  let serverUrl: string = "";

  async function startHttpServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use port 0 to let OS assign free port
      serverProcess = spawn("npx", ["tsx", path.join(FIXTURES_DIR, "http-server.ts"), "0"], {
        cwd: FIXTURES_DIR,
        stdio: ["ignore", "pipe", "pipe"],
        detached: false, // Ensure child process is attached to parent
      });

      let resolved = false;

      serverProcess.stdout?.on("data", (data) => {
        const output = data.toString();
        // Parse the actual port from server output
        const portMatch = output.match(/listening on port (\d+)/);
        if (portMatch && !resolved) {
          resolved = true;
          const port = portMatch[1];
          serverUrl = `http://localhost:${port}/mcp`;
          // Give it a moment to be fully ready
          setTimeout(resolve, 500);
        }
      });

      serverProcess.stderr?.on("data", (data) => {
        // Log errors during startup to help debug
        if (!resolved) {
          const msg = data.toString();
          if (msg.includes("EADDRINUSE")) {
            reject(new Error("Port conflict - this should not happen with port 0"));
          }
        }
      });

      serverProcess.on("error", (err) => {
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      serverProcess.on("exit", (code) => {
        if (!resolved && code !== 0) {
          resolved = true;
          reject(new Error(`Server exited with code ${code}`));
        }
      });

      // Timeout after 10s
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error("Server startup timeout"));
        }
      }, 10000);
    });
  }

  async function stopHttpServer(): Promise<void> {
    if (serverProcess) {
      const proc = serverProcess;
      serverProcess = null;

      // Try graceful shutdown first
      proc.kill("SIGTERM");

      // Wait for exit with timeout, then force kill
      await new Promise<void>((resolve) => {
        const forceKillTimeout = setTimeout(() => {
          proc.kill("SIGKILL");
        }, 1000);

        proc.on("exit", () => {
          clearTimeout(forceKillTimeout);
          resolve();
        });

        // Final safety timeout
        setTimeout(resolve, 2000);
      });
    }
  }

  beforeAll(async () => {
    await startHttpServer();
  });

  afterAll(async () => {
    await stopHttpServer();
  });

  it("probes a real HTTP MCP server", async () => {
    const result = await probeServer({
      transport: "streamable-http",
      url: serverUrl,
    });

    // Should not have errors
    expect(result.error).toBeUndefined();

    // Should have initialize info
    expect(result.initialize).not.toBeNull();
    expect(result.initialize?.serverInfo?.name).toBe("test-http-server");
    expect(result.initialize?.serverInfo?.version).toBe("1.0.0");

    // Should have tools
    expect(result.tools).not.toBeNull();
    expect(result.tools?.tools).toHaveLength(1);
    expect(result.tools?.tools[0].name).toBe("echo");
  });

  it("returns error for unavailable HTTP server", async () => {
    const result = await probeServer({
      transport: "streamable-http",
      url: "http://localhost:59999/mcp", // Port that's not listening
    });

    // Should have an error
    expect(result.error).toBeDefined();
  });
});

describe("Integration: normalization end-to-end", () => {
  it("normalizes probe results consistently", async () => {
    const result = await probeServer({
      transport: "stdio",
      command: "npx",
      args: ["tsx", path.join(FIXTURES_DIR, "stdio-server.ts")],
      workingDir: FIXTURES_DIR,
    });

    expect(result.error).toBeUndefined();

    // Convert to files
    const files = probeResultToFiles(result);

    // Should have expected files
    expect(files.has("initialize")).toBe(true);
    expect(files.has("tools")).toBe(true);
    expect(files.has("prompts")).toBe(true);
    expect(files.has("resources")).toBe(true);

    // Parse and verify tools are normalized (sorted)
    const tools = JSON.parse(files.get("tools")!);
    const toolNames = tools.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toEqual(["add", "greet"]); // Sorted alphabetically

    // Verify the JSON is deterministic
    const files2 = probeResultToFiles(result);
    expect(files.get("tools")).toBe(files2.get("tools"));
    expect(files.get("initialize")).toBe(files2.get("initialize"));
  });

  it("produces identical output for semantically identical servers", async () => {
    // Probe the server twice
    const result1 = await probeServer({
      transport: "stdio",
      command: "npx",
      args: ["tsx", path.join(FIXTURES_DIR, "stdio-server.ts")],
      workingDir: FIXTURES_DIR,
    });

    const result2 = await probeServer({
      transport: "stdio",
      command: "npx",
      args: ["tsx", path.join(FIXTURES_DIR, "stdio-server.ts")],
      workingDir: FIXTURES_DIR,
    });

    expect(result1.error).toBeUndefined();
    expect(result2.error).toBeUndefined();

    const files1 = probeResultToFiles(result1);
    const files2 = probeResultToFiles(result2);

    // All files should be identical
    for (const [name, content] of files1) {
      expect(files2.get(name)).toBe(content);
    }
  });
});

describe("Integration: custom messages", () => {
  it("sends custom messages and captures responses", async () => {
    // The stdio server supports tools/list which we can call as a custom message
    const result = await probeServer({
      transport: "stdio",
      command: "npx",
      args: ["tsx", path.join(FIXTURES_DIR, "stdio-server.ts")],
      workingDir: FIXTURES_DIR,
      customMessages: [
        {
          id: 1,
          name: "list-tools-custom",
          message: { method: "tools/list", params: {} },
        },
      ],
    });

    expect(result.error).toBeUndefined();

    // Should have custom response
    expect(result.customResponses.has("list-tools-custom")).toBe(true);
    const customResponse = result.customResponses.get("list-tools-custom") as { tools: unknown[] };
    expect(customResponse.tools).toHaveLength(2);
  });
});

describe("Integration: environment variables", () => {
  it("passes environment variables to stdio server", async () => {
    const result = await probeServer({
      transport: "stdio",
      command: "npx",
      args: ["tsx", path.join(FIXTURES_DIR, "stdio-server.ts")],
      workingDir: FIXTURES_DIR,
      envVars: {
        TEST_VAR: "test_value",
      },
    });

    // Server should start successfully (it doesn't use the env var, but it should be passed)
    expect(result.error).toBeUndefined();
    expect(result.initialize?.serverInfo?.name).toBe("test-stdio-server");
  });
});
