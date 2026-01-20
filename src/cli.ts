/**
 * MCP Server Diff - CLI Entry Point
 *
 * Standalone CLI for diffing MCP server public interfaces.
 * Can compare any two servers or multiple servers against a base.
 */

import { parseArgs } from "node:util";
import * as fs from "fs";
import * as readline from "readline";
import { probeServer } from "./probe.js";
import { compareProbeResults, extractCounts, type DiffResult } from "./diff.js";
import { ConsoleLogger, QuietLogger, setLogger, log } from "./logger.js";
import type { ProbeResult, PrimitiveCounts } from "./types.js";

interface ServerConfig {
  name: string;
  transport: "stdio" | "streamable-http";
  start_command?: string;
  server_url?: string;
  headers?: Record<string, string>;
  env_vars?: Record<string, string>;
}

interface DiffConfig {
  base: ServerConfig;
  targets: ServerConfig[];
}

interface ComparisonResult {
  base: string;
  target: string;
  hasDifferences: boolean;
  diffs: DiffResult[];
  baseCounts: PrimitiveCounts;
  targetCounts: PrimitiveCounts;
  error?: string;
}

/**
 * Parse command line arguments
 */
function parseCliArgs() {
  const { values, positionals } = parseArgs({
    options: {
      base: { type: "string", short: "b" },
      target: { type: "string", short: "t" },
      header: { type: "string", short: "H", multiple: true },
      "base-header": { type: "string", short: "B", multiple: true },
      "target-header": { type: "string", short: "T", multiple: true },
      config: { type: "string", short: "c" },
      output: { type: "string", short: "o", default: "summary" },
      verbose: { type: "boolean", short: "v", default: false },
      quiet: { type: "boolean", short: "q", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  return { values, positionals };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
mcp-server-diff - Diff MCP server public interfaces

USAGE:
  mcp-server-diff [OPTIONS]
  mcp-server-diff --base "python -m server" --target "node dist/stdio.js"
  mcp-server-diff --config servers.json

OPTIONS:
  -b, --base <command>       Base server command (stdio) or URL (http)
  -t, --target <command>     Target server command (stdio) or URL (http)
  -H, --header <header>      HTTP header for target (repeatable)
  -B, --base-header <header> HTTP header for base server (repeatable)
  -T, --target-header <hdr>  HTTP header for target server (repeatable, same as -H)
                             Values support: env:VAR_NAME, secret:name, "Bearer secret:token"
  -c, --config <file>        Config file with base and targets
  -o, --output <format>      Output format: diff, json, markdown, summary (default: summary)
  -v, --verbose              Verbose output
  -q, --quiet                Quiet mode (only output diffs)
  -h, --help                 Show this help
      --version              Show version

CONFIG FILE FORMAT:
  {
    "base": {
      "name": "python-server",
      "transport": "stdio",
      "start_command": "python -m mcp_server"
    },
    "targets": [
      {
        "name": "typescript-server",
        "transport": "stdio",
        "start_command": "node dist/stdio.js"
      }
    ]
  }

OUTPUT FORMATS:
  diff      - Raw diff output only
  summary   - One line per comparison (default)
  json      - Raw JSON with full diff details
  markdown  - Formatted markdown report

EXAMPLES:
  # Compare two stdio servers
  mcp-server-diff -b "python -m server" -t "node dist/index.js"

  # Compare against HTTP server
  mcp-server-diff -b "python -m server" -t "http://localhost:3000/mcp"

  # Use config file for multiple comparisons
  mcp-server-diff -c servers.json -o markdown

  # Output raw JSON for CI
  mcp-server-diff -c servers.json -o json -q

  # Compare with HTTP headers (for authenticated endpoints)
  mcp-server-diff -b "go run ./cmd/server stdio" -t "https://api.example.com/mcp" \\
    -H "Authorization: Bearer token" -o diff

  # Use environment variable for secret (keeps token out of shell history)
  mcp-server-diff -b "./server" -t "https://api.example.com/mcp" \\
    -H "Authorization: env:MY_API_TOKEN"

  # Prompt for secret interactively (hidden input)
  mcp-server-diff -b "./server" -t "https://api.example.com/mcp" \\
    -H "Authorization: secret:"
`);
}

/**
 * Load and parse config file
 */
function loadConfig(configPath: string): DiffConfig {
  const content = fs.readFileSync(configPath, "utf-8");
  const config = JSON.parse(content) as DiffConfig;

  if (!config.base) {
    throw new Error("Config must have a 'base' server");
  }
  if (!config.targets || config.targets.length === 0) {
    throw new Error("Config must have at least one 'target' server");
  }

  return config;
}

/**
 * Create a server config from a command string
 */
function commandToConfig(
  command: string,
  name: string,
  headers?: Record<string, string>
): ServerConfig {
  if (command.startsWith("http://") || command.startsWith("https://")) {
    return {
      name,
      transport: "streamable-http",
      server_url: command,
      headers,
    };
  }

  return {
    name,
    transport: "stdio",
    start_command: command,
  };
}

/**
 * Parse header strings into a record
 * Accepts formats: "Header: value" or "Header=value"
 * Special value patterns:
 *   env:VAR_NAME - reads from environment variable
 *   secret:name - prompts for secret (name is the prompt label)
 *   "Bearer secret:token" - prefix + secret (prompts for "token", prepends "Bearer ")
 */
function parseHeaders(
  headerStrings?: string[],
  secretValues?: Map<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!headerStrings) return headers;

  for (const h of headerStrings) {
    const colonIdx = h.indexOf(":");
    const eqIdx = h.indexOf("=");
    const sepIdx = colonIdx > 0 ? colonIdx : eqIdx;

    if (sepIdx > 0) {
      const key = h.substring(0, sepIdx).trim();
      let value = h.substring(sepIdx + 1).trim();

      // Check for env: prefix to read from environment variable
      if (value.startsWith("env:")) {
        const envVar = value.substring(4);
        const envValue = process.env[envVar];
        if (!envValue) {
          throw new Error(`Environment variable ${envVar} not set (referenced in header ${key})`);
        }
        value = envValue;
      } else if (value.includes("secret:")) {
        // Replace secret:name with the prompted value
        const secretMatch = value.match(/secret:(\w+)/);
        if (secretMatch) {
          const secretName = secretMatch[1];
          if (secretValues?.has(secretName)) {
            value = value.replace(`secret:${secretName}`, secretValues.get(secretName)!);
          } else {
            throw new Error(`Secret value for "${secretName}" not collected`);
          }
        }
      }

      headers[key] = value;
    }
  }
  return headers;
}

/**
 * Find secrets that need prompts, returns array of {name, label} objects
 */
function findSecrets(headerStrings?: string[]): Array<{ name: string; label: string }> {
  const secrets: Array<{ name: string; label: string }> = [];
  if (!headerStrings) return secrets;

  for (const h of headerStrings) {
    const secretMatch = h.match(/secret:(\w+)/);
    if (secretMatch) {
      const name = secretMatch[1];
      // Don't add duplicates
      if (!secrets.find((s) => s.name === name)) {
        secrets.push({ name, label: name });
      }
    }
  }
  return secrets;
}

/**
 * Prompt for a secret value with hidden input
 */
async function promptSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Hide input by using raw mode if available
    if (process.stdin.isTTY) {
      process.stdout.write(`${prompt}: `);
      process.stdin.setRawMode(true);
      process.stdin.resume();

      let value = "";
      const onData = (char: Buffer) => {
        const c = char.toString();
        if (c === "\n" || c === "\r") {
          process.stdin.setRawMode(false);
          process.stdin.removeListener("data", onData);
          rl.close();
          process.stdout.write("\n");
          resolve(value);
        } else if (c === "\u0003") {
          // Ctrl+C
          process.exit(1);
        } else if (c === "\u007F" || c === "\b") {
          // Backspace
          if (value.length > 0) {
            value = value.slice(0, -1);
          }
        } else {
          value += c;
        }
      };
      process.stdin.on("data", onData);
    } else {
      // Non-TTY: just read the line (won't be hidden)
      rl.question(`${prompt}: `, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

/**
 * Prompt for secret values with hidden input
 */
async function promptSecrets(
  secrets: Array<{ name: string; label: string }>
): Promise<Map<string, string>> {
  const values = new Map<string, string>();
  if (secrets.length === 0) return values;

  for (const { name, label } of secrets) {
    values.set(name, await promptSecret(`Enter ${label}`));
  }
  return values;
}

/**
 * Probe a server and return results
 */
async function probeServerConfig(config: ServerConfig): Promise<ProbeResult> {
  if (config.transport === "stdio") {
    if (!config.start_command) {
      throw new Error(`No start_command for stdio server: ${config.name}`);
    }

    const parts = config.start_command.split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);

    return await probeServer({
      transport: "stdio",
      command,
      args,
      envVars: config.env_vars,
    });
  } else {
    if (!config.server_url) {
      throw new Error(`No server_url for HTTP server: ${config.name}`);
    }

    return await probeServer({
      transport: "streamable-http",
      url: config.server_url,
      headers: config.headers,
      envVars: config.env_vars,
    });
  }
}

/**
 * Compare base against all targets
 */
async function runComparisons(config: DiffConfig): Promise<ComparisonResult[]> {
  const results: ComparisonResult[] = [];

  log.info(`\n📍 Probing base: ${config.base.name}`);
  let baseResult: ProbeResult;
  try {
    baseResult = await probeServerConfig(config.base);
    if (baseResult.error) {
      throw new Error(baseResult.error);
    }
  } catch (error) {
    log.error(`Failed to probe base server: ${error}`);
    return config.targets.map((target) => ({
      base: config.base.name,
      target: target.name,
      hasDifferences: true,
      diffs: [{ endpoint: "error", diff: `Base server probe failed: ${error}` }],
      baseCounts: { tools: 0, prompts: 0, resources: 0, resourceTemplates: 0 },
      targetCounts: { tools: 0, prompts: 0, resources: 0, resourceTemplates: 0 },
      error: String(error),
    }));
  }

  const baseCounts = extractCounts(baseResult);

  for (const target of config.targets) {
    log.info(`\n🎯 Probing target: ${target.name}`);

    const result: ComparisonResult = {
      base: config.base.name,
      target: target.name,
      hasDifferences: false,
      diffs: [],
      baseCounts,
      targetCounts: { tools: 0, prompts: 0, resources: 0, resourceTemplates: 0 },
    };

    try {
      const targetResult = await probeServerConfig(target);

      if (targetResult.error) {
        result.hasDifferences = true;
        result.diffs = [{ endpoint: "error", diff: `Target probe failed: ${targetResult.error}` }];
        result.error = targetResult.error;
      } else {
        result.targetCounts = extractCounts(targetResult);
        result.diffs = compareProbeResults(baseResult, targetResult);
        result.hasDifferences = result.diffs.length > 0;
      }
    } catch (error) {
      result.hasDifferences = true;
      result.diffs = [{ endpoint: "error", diff: `Target probe failed: ${error}` }];
      result.error = String(error);
    }

    results.push(result);
  }

  return results;
}

/**
 * Output raw diff only
 */
function outputDiff(results: ComparisonResult[]): void {
  for (const result of results) {
    if (result.diffs.length > 0) {
      if (results.length > 1) {
        console.log(`# ${result.target}`);
      }
      for (const { endpoint, diff } of result.diffs) {
        console.log(`## ${endpoint}`);
        console.log(diff);
        console.log("");
      }
    }
  }
}

/**
 * Output results in summary format
 */
function outputSummary(results: ComparisonResult[]): void {
  console.log("\n📊 Comparison Results:\n");

  let hasAnyDiff = false;
  for (const result of results) {
    const status = result.hasDifferences ? "❌" : "✅";
    const diffCount = result.diffs.length;
    const counts = `(${result.targetCounts.tools}T/${result.targetCounts.prompts}P/${result.targetCounts.resources}R)`;

    if (result.error) {
      console.log(`${status} ${result.target} ${counts} - ERROR: ${result.error}`);
    } else if (result.hasDifferences) {
      console.log(`${status} ${result.target} ${counts} - ${diffCount} difference(s)`);
      hasAnyDiff = true;
    } else {
      console.log(`${status} ${result.target} ${counts} - matches base`);
    }
  }

  console.log("");
  if (hasAnyDiff) {
    console.log("Run with -o markdown or -o json for detailed diffs.");
  }
}

/**
 * Output results in JSON format
 */
function outputJson(results: ComparisonResult[]): void {
  const output = {
    timestamp: new Date().toISOString(),
    results: results.map((r) => ({
      base: r.base,
      target: r.target,
      hasDifferences: r.hasDifferences,
      baseCounts: r.baseCounts,
      targetCounts: r.targetCounts,
      diffs: r.diffs,
      error: r.error,
    })),
    summary: {
      total: results.length,
      matching: results.filter((r) => !r.hasDifferences).length,
      different: results.filter((r) => r.hasDifferences).length,
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

/**
 * Output results in markdown format
 */
function outputMarkdown(results: ComparisonResult[]): void {
  const lines: string[] = [];

  lines.push("# MCP Server Diff Report");
  lines.push("");
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push("| Server | Tools | Prompts | Resources | Status |");
  lines.push("|--------|-------|---------|-----------|--------|");

  for (const result of results) {
    const status = result.hasDifferences
      ? result.error
        ? "❌ Error"
        : `⚠️ ${result.diffs.length} diff(s)`
      : "✅ Match";
    const c = result.targetCounts;
    lines.push(`| ${result.target} | ${c.tools} | ${c.prompts} | ${c.resources} | ${status} |`);
  }

  lines.push("");

  const diffsPresent = results.filter((r) => r.hasDifferences && r.diffs.length > 0);
  if (diffsPresent.length > 0) {
    lines.push("## Differences");
    lines.push("");

    for (const result of diffsPresent) {
      lines.push(`### ${result.target}`);
      lines.push("");

      for (const { endpoint, diff } of result.diffs) {
        lines.push(`**${endpoint}**`);
        lines.push("");
        lines.push("```diff");
        lines.push(diff);
        lines.push("```");
        lines.push("");
      }
    }
  } else {
    lines.push("## ✅ All Servers Match");
    lines.push("");
    lines.push("No differences detected between base and target servers.");
  }

  console.log(lines.join("\n"));
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const { values } = parseCliArgs();

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  if (values.version) {
    console.log("mcp-server-diff v2.1.1");
    process.exit(0);
  }

  // Set up logger - CLI uses console logger by default
  if (values.quiet) {
    setLogger(new QuietLogger());
  } else {
    setLogger(new ConsoleLogger(values.verbose || false));
  }

  let config: DiffConfig;

  if (values.config) {
    config = loadConfig(values.config);
  } else if (values.base && values.target) {
    // Combine -H and --target-header for target, use --base-header for base
    const baseHeaderStrings = values["base-header"] as string[] | undefined;
    const targetHeaderStrings = [
      ...((values.header as string[]) || []),
      ...((values["target-header"] as string[]) || []),
    ];

    // Find all secrets needed from both header sets
    const allHeaderStrings = [...(baseHeaderStrings || []), ...targetHeaderStrings];
    const secrets = findSecrets(allHeaderStrings);
    const secretValues = await promptSecrets(secrets);

    const baseHeaders = parseHeaders(baseHeaderStrings, secretValues);
    const targetHeaders = parseHeaders(
      targetHeaderStrings.length > 0 ? targetHeaderStrings : undefined,
      secretValues
    );

    config = {
      base: commandToConfig(values.base, "base", baseHeaders),
      targets: [commandToConfig(values.target, "target", targetHeaders)],
    };
  } else {
    console.error("Error: Must provide --config or both --base and --target");
    console.error("Run with --help for usage.");
    process.exit(1);
  }

  const results = await runComparisons(config);

  const outputFormat = values.output || "summary";
  switch (outputFormat) {
    case "diff":
      outputDiff(results);
      break;
    case "json":
      outputJson(results);
      break;
    case "markdown":
      outputMarkdown(results);
      break;
    case "summary":
    default:
      outputSummary(results);
      break;
  }

  const hasDiffs = results.some((r) => r.hasDifferences);
  process.exit(hasDiffs ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
