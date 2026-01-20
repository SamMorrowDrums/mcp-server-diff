/**
 * MCP Server Diff - CLI Entry Point
 *
 * Standalone CLI for diffing MCP server public interfaces.
 * Can compare any two servers or multiple servers against a base.
 */

import { parseArgs } from "node:util";
import * as fs from "fs";
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
  -b, --base <command>     Base server command (stdio) or URL (http)
  -t, --target <command>   Target server command (stdio) or URL (http)
  -c, --config <file>      Config file with base and targets
  -o, --output <format>    Output format: diff, json, markdown, summary (default: summary)
  -v, --verbose            Verbose output
  -q, --quiet              Quiet mode (only output diffs)
  -h, --help               Show this help
      --version            Show version

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
function commandToConfig(command: string, name: string): ServerConfig {
  if (command.startsWith("http://") || command.startsWith("https://")) {
    return {
      name,
      transport: "streamable-http",
      server_url: command,
    };
  }

  return {
    name,
    transport: "stdio",
    start_command: command,
  };
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
    config = {
      base: commandToConfig(values.base, "base"),
      targets: [commandToConfig(values.target, "target")],
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
