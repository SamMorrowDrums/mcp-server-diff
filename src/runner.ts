/**
 * Test runner for MCP conformance testing
 */

import * as exec from "@actions/exec";
import * as core from "@actions/core";
import * as path from "path";
import * as fs from "fs";
import { spawn, ChildProcess } from "child_process";
import { probeServer, probeResultToFiles } from "./probe.js";
import { createWorktree, removeWorktree, checkout, checkoutPrevious } from "./git.js";
import type {
  TestConfiguration,
  ActionInputs,
  TestResult,
  ProbeResult,
  CustomMessage,
} from "./types.js";

interface RunContext {
  workDir: string;
  inputs: ActionInputs;
  compareRef: string;
}

/**
 * Parse configurations from input
 */
export function parseConfigurations(
  input: string | undefined,
  defaultTransport: "stdio" | "streamable-http",
  defaultCommand: string,
  defaultUrl: string
): TestConfiguration[] {
  if (!input || input.trim() === "[]" || input.trim() === "") {
    // Return single default configuration
    return [
      {
        name: "default",
        transport: defaultTransport,
        start_command: defaultTransport === "stdio" ? defaultCommand : undefined,
        server_url: defaultTransport === "streamable-http" ? defaultUrl : undefined,
      },
    ];
  }

  try {
    const configs = JSON.parse(input) as TestConfiguration[];
    if (!Array.isArray(configs) || configs.length === 0) {
      throw new Error("Configurations must be a non-empty array");
    }

    // Apply defaults to each configuration
    return configs.map((config) => {
      const transport = config.transport || defaultTransport;
      return {
        ...config,
        transport,
        // For stdio, use default command if not specified (appending args if needed)
        start_command:
          transport === "stdio" ? config.start_command || defaultCommand : config.start_command,
        // For HTTP, use default URL if not specified
        server_url:
          transport === "streamable-http" ? config.server_url || defaultUrl : config.server_url,
      };
    });
  } catch (error) {
    core.warning(`Failed to parse configurations: ${error}`);
    // Return default
    return [
      {
        name: "default",
        transport: defaultTransport,
        start_command: defaultTransport === "stdio" ? defaultCommand : undefined,
        server_url: defaultTransport === "streamable-http" ? defaultUrl : undefined,
      },
    ];
  }
}

/**
 * Parse custom messages from input
 */
export function parseCustomMessages(input: string | undefined): CustomMessage[] {
  if (!input || input.trim() === "[]" || input.trim() === "") {
    return [];
  }

  try {
    const messages = JSON.parse(input) as CustomMessage[];
    return Array.isArray(messages) ? messages : [];
  } catch {
    return [];
  }
}

/**
 * Parse headers from input (JSON object or KEY=value format, newline separated)
 */
export function parseHeaders(input: string | undefined): Record<string, string> {
  if (!input || input.trim() === "" || input.trim() === "{}") {
    return {};
  }

  // Try JSON first
  try {
    const parsed = JSON.parse(input);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // Not JSON, try KEY=value format
  }

  // Fall back to KEY=value format
  const headers: Record<string, string> = {};
  const lines = input.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIndex = trimmed.indexOf(":");
    const eqIndex = trimmed.indexOf("=");

    // Support both "Header: value" and "Header=value" formats
    const sepIndex = colonIndex > 0 ? colonIndex : eqIndex;
    if (sepIndex > 0) {
      const key = trimmed.substring(0, sepIndex).trim();
      const value = trimmed.substring(sepIndex + 1).trim();
      headers[key] = value;
    }
  }
  return headers;
}

/**
 * Parse environment variables from string (KEY=value format, newline separated)
 */
export function parseEnvVars(input?: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!input) return env;

  const lines = input.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex);
      const value = trimmed.substring(eqIndex + 1);
      env[key] = value;
    }
  }
  return env;
}

/**
 * Run build commands in a directory
 */
async function runBuild(dir: string, inputs: ActionInputs): Promise<void> {
  const options = { cwd: dir };

  if (inputs.installCommand) {
    core.info(`  Running install: ${inputs.installCommand}`);
    await exec.exec("sh", ["-c", inputs.installCommand], options);
  }

  if (inputs.buildCommand) {
    core.info(`  Running build: ${inputs.buildCommand}`);
    await exec.exec("sh", ["-c", inputs.buildCommand], options);
  }
}

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Start an HTTP server process for the given configuration.
 * Returns the spawned process which should be killed after probing.
 */
async function startHttpServer(
  config: TestConfiguration,
  workDir: string,
  envVars: Record<string, string>
): Promise<ChildProcess | null> {
  if (!config.start_command) {
    return null;
  }

  core.info(`  Starting HTTP server: ${config.start_command}`);

  // Merge environment variables
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(envVars)) {
    env[key] = value;
  }

  const serverProcess = spawn("sh", ["-c", config.start_command], {
    cwd: workDir,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Log server output for debugging
  serverProcess.stdout?.on("data", (data) => {
    core.debug(`  [server stdout]: ${data.toString().trim()}`);
  });
  serverProcess.stderr?.on("data", (data) => {
    core.debug(`  [server stderr]: ${data.toString().trim()}`);
  });

  // Wait for server to start up
  const waitMs = config.startup_wait_ms ?? config.pre_test_wait_ms ?? 2000;
  core.info(`  Waiting ${waitMs}ms for server to start...`);
  await sleep(waitMs);

  // Check if process is still running
  if (serverProcess.exitCode !== null) {
    throw new Error(`HTTP server exited prematurely with code ${serverProcess.exitCode}`);
  }

  core.info("  HTTP server started");
  return serverProcess;
}

/**
 * Stop an HTTP server process
 */
function stopHttpServer(serverProcess: ChildProcess | null): void {
  if (!serverProcess) {
    return;
  }

  core.info("  Stopping HTTP server...");
  try {
    // Kill the process group (negative PID kills the group)
    if (serverProcess.pid) {
      process.kill(-serverProcess.pid, "SIGTERM");
    }
  } catch (error) {
    // Process might already be dead
    core.debug(`  Error stopping server: ${error}`);
  }
}

/**
 * Run pre-test command if specified
 */
async function runPreTestCommand(config: TestConfiguration, workDir: string): Promise<void> {
  if (config.pre_test_command) {
    core.info(`  Running pre-test command: ${config.pre_test_command}`);
    await exec.exec("sh", ["-c", config.pre_test_command], { cwd: workDir });

    if (config.pre_test_wait_ms && config.pre_test_wait_ms > 0) {
      core.info(`  Waiting ${config.pre_test_wait_ms}ms for service to be ready...`);
      await sleep(config.pre_test_wait_ms);
    }
  }
}

/**
 * Run post-test command if specified (cleanup)
 */
async function runPostTestCommand(config: TestConfiguration, workDir: string): Promise<void> {
  if (config.post_test_command) {
    core.info(`  Running post-test command: ${config.post_test_command}`);
    try {
      await exec.exec("sh", ["-c", config.post_test_command], { cwd: workDir });
    } catch (error) {
      // Log but don't fail - cleanup errors shouldn't break the test
      core.warning(`  Post-test command failed: ${error}`);
    }
  }
}

/**
 * Probe a server with a specific configuration
 */
async function probeWithConfig(
  config: TestConfiguration,
  workDir: string,
  globalEnvVars: Record<string, string>,
  globalHeaders: Record<string, string>,
  globalCustomMessages: CustomMessage[]
): Promise<ProbeResult> {
  const configEnvVars = parseEnvVars(config.env_vars);
  const envVars = { ...globalEnvVars, ...configEnvVars };
  const headers = { ...globalHeaders, ...config.headers };
  const customMessages = config.custom_messages || globalCustomMessages;

  // Run pre-test command before probing
  await runPreTestCommand(config, workDir);

  if (config.transport === "stdio") {
    const command = config.start_command || "";
    const parts = command.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    // Also parse additional args if provided
    if (config.args) {
      args.push(...config.args.split(/\s+/));
    }

    return await probeServer({
      transport: "stdio",
      command: cmd,
      args,
      workingDir: workDir,
      envVars,
      customMessages,
    });
  } else {
    // For HTTP transport, optionally start the server if start_command is provided
    let serverProcess: ChildProcess | null = null;
    try {
      if (config.start_command) {
        serverProcess = await startHttpServer(config, workDir, envVars);
      }

      return await probeServer({
        transport: "streamable-http",
        url: config.server_url,
        headers,
        envVars,
        customMessages,
      });
    } finally {
      // Always stop the server if we started it
      stopHttpServer(serverProcess);
    }
  }
}

/**
 * Compare two sets of probe result files and return diffs
 */
function compareResults(
  branchFiles: Map<string, string>,
  baseFiles: Map<string, string>
): Map<string, string> {
  const diffs = new Map<string, string>();

  // Check all endpoints
  const allEndpoints = new Set([...branchFiles.keys(), ...baseFiles.keys()]);

  for (const endpoint of allEndpoints) {
    const branchContent = branchFiles.get(endpoint);
    const baseContent = baseFiles.get(endpoint);

    if (!branchContent && baseContent) {
      diffs.set(endpoint, `Endpoint removed in current branch (was present in base)`);
    } else if (branchContent && !baseContent) {
      diffs.set(endpoint, `Endpoint added in current branch (not present in base)`);
    } else if (branchContent !== baseContent) {
      // Generate a simple diff
      const diff = generateSimpleDiff(endpoint, baseContent || "", branchContent || "");
      if (diff) {
        diffs.set(endpoint, diff);
      }
    }
  }

  return diffs;
}

/**
 * Generate a simple line-by-line diff
 */
function generateSimpleDiff(name: string, base: string, branch: string): string | null {
  const baseLines = base.split("\n");
  const branchLines = branch.split("\n");

  const diffLines: string[] = [];
  const maxLines = Math.max(baseLines.length, branchLines.length);

  for (let i = 0; i < maxLines; i++) {
    const baseLine = baseLines[i];
    const branchLine = branchLines[i];

    if (baseLine !== branchLine) {
      if (baseLine !== undefined) {
        diffLines.push(`- ${baseLine}`);
      }
      if (branchLine !== undefined) {
        diffLines.push(`+ ${branchLine}`);
      }
    }
  }

  if (diffLines.length === 0) {
    return null;
  }

  return `--- base/${name}.json\n+++ branch/${name}.json\n${diffLines.join("\n")}`;
}

/**
 * Run conformance tests for a single configuration
 */
export async function runSingleConfigTest(
  config: TestConfiguration,
  ctx: RunContext
): Promise<TestResult> {
  const result: TestResult = {
    configName: config.name,
    transport: config.transport,
    branchTime: 0,
    baseTime: 0,
    hasDifferences: false,
    diffs: new Map(),
  };

  const globalEnvVars = parseEnvVars(ctx.inputs.envVars);
  const globalHeaders = ctx.inputs.headers || {};
  const globalCustomMessages = ctx.inputs.customMessages || [];

  core.info(`\n📋 Testing configuration: ${config.name} (${config.transport})`);

  // Test current branch
  core.info("🔄 Testing current branch...");
  const branchStart = Date.now();
  let branchResult: ProbeResult;
  try {
    branchResult = await probeWithConfig(
      config,
      ctx.workDir,
      globalEnvVars,
      globalHeaders,
      globalCustomMessages
    );
  } finally {
    // Always run post-test cleanup
    await runPostTestCommand(config, ctx.workDir);
  }
  result.branchTime = Date.now() - branchStart;

  if (branchResult.error) {
    core.warning(`Error on current branch: ${branchResult.error}`);
    result.hasDifferences = true;
    result.diffs.set("error", `Current branch probe failed: ${branchResult.error}`);
    return result;
  }

  const branchFiles = probeResultToFiles(branchResult);

  // Set up comparison ref
  const worktreePath = path.join(ctx.workDir, ".conformance-base");
  let useWorktree = false;

  try {
    core.info(`🔄 Setting up comparison ref: ${ctx.compareRef}`);

    // Try worktree first
    useWorktree = await createWorktree(ctx.compareRef, worktreePath);

    if (!useWorktree) {
      core.info("  Worktree not available, using checkout");
      await checkout(ctx.compareRef);
    }

    const baseWorkDir = useWorktree ? worktreePath : ctx.workDir;

    // Build on base
    core.info("🔨 Building on comparison ref...");
    await runBuild(baseWorkDir, ctx.inputs);

    // Probe on base
    core.info("🔄 Testing comparison ref...");
    const baseStart = Date.now();
    let baseResult: ProbeResult;
    try {
      baseResult = await probeWithConfig(
        config,
        baseWorkDir,
        globalEnvVars,
        globalHeaders,
        globalCustomMessages
      );
    } finally {
      // Always run post-test cleanup
      await runPostTestCommand(config, baseWorkDir);
    }
    result.baseTime = Date.now() - baseStart;

    if (baseResult.error) {
      core.warning(`Error on base ref: ${baseResult.error}`);
      result.hasDifferences = true;
      result.diffs.set("error", `Base ref probe failed: ${baseResult.error}`);
      return result;
    }

    const baseFiles = probeResultToFiles(baseResult);

    // Compare results
    result.diffs = compareResults(branchFiles, baseFiles);
    result.hasDifferences = result.diffs.size > 0;

    if (result.hasDifferences) {
      core.warning(`⚠️ Configuration ${config.name}: ${result.diffs.size} differences found`);
    } else {
      core.info(`✅ Configuration ${config.name}: no differences`);
    }
  } finally {
    // Clean up
    if (useWorktree) {
      await removeWorktree(worktreePath);
    } else {
      await checkoutPrevious();
    }
  }

  return result;
}

/**
 * Run all conformance tests
 */
export async function runAllTests(ctx: RunContext): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (const config of ctx.inputs.configurations) {
    try {
      const result = await runSingleConfigTest(config, ctx);
      results.push(result);

      // Save individual result
      const resultPath = path.join(ctx.workDir, ".conformance-results", `${config.name}.json`);
      fs.mkdirSync(path.dirname(resultPath), { recursive: true });
      fs.writeFileSync(
        resultPath,
        JSON.stringify(
          {
            ...result,
            diffs: Object.fromEntries(result.diffs),
          },
          null,
          2
        )
      );
    } catch (error) {
      core.error(`Failed to run configuration ${config.name}: ${error}`);
      results.push({
        configName: config.name,
        transport: config.transport,
        branchTime: 0,
        baseTime: 0,
        hasDifferences: true,
        diffs: new Map([["error", String(error)]]),
      });
    }
  }

  return results;
}
