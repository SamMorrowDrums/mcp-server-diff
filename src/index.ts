/**
 * MCP Conformance Action - Main Entry Point
 *
 * Tests MCP server implementations for conformance by comparing
 * API responses between the current branch and a reference.
 */

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { getCurrentBranch, determineCompareRef } from "./git.js";
import { parseConfigurations, parseCustomMessages, parseHeaders, runAllTests } from "./runner.js";
import { generateReport, generateMarkdownReport, saveReport } from "./reporter.js";
import type { ActionInputs } from "./types.js";

/**
 * Get all inputs from the action (composite action style - INPUT_* env vars)
 */
function getInputs(): ActionInputs {
  // Helper to get input from INPUT_* environment variables
  const getInput = (name: string): string => {
    const envName = `INPUT_${name.toUpperCase().replace(/-/g, "_")}`;
    return process.env[envName] || "";
  };

  const getBooleanInput = (name: string): boolean => {
    const value = getInput(name);
    return value.toLowerCase() === "true";
  };

  const transport = (getInput("transport") || "stdio") as "stdio" | "streamable-http";
  const startCommand = getInput("start_command");
  const serverUrl = getInput("server_url");

  // Parse configurations
  const configurationsInput = getInput("configurations");
  const configurations = parseConfigurations(
    configurationsInput,
    transport,
    startCommand,
    serverUrl
  );

  // Parse custom messages
  const customMessagesInput = getInput("custom_messages");
  const customMessages = parseCustomMessages(customMessagesInput);

  // Parse global headers
  const headersInput = getInput("headers");
  const headers = parseHeaders(headersInput);

  return {
    // Language setup
    setupNode: getBooleanInput("setup_node"),
    nodeVersion: getInput("node_version") || "20",
    setupPython: getBooleanInput("setup_python"),
    pythonVersion: getInput("python_version") || "3.11",
    setupGo: getBooleanInput("setup_go"),
    goVersion: getInput("go_version") || "1.24",
    setupRust: getBooleanInput("setup_rust"),
    rustToolchain: getInput("rust_toolchain") || "stable",
    setupDotnet: getBooleanInput("setup_dotnet"),
    dotnetVersion: getInput("dotnet_version") || "9.0.x",

    // Build configuration
    installCommand: getInput("install_command"),
    buildCommand: getInput("build_command"),
    startCommand,

    // Transport configuration
    transport,
    serverUrl,
    headers,
    configurations,
    customMessages,

    // Test configuration
    compareRef: getInput("compare_ref"),
    failOnError: getBooleanInput("fail_on_error") !== false, // default true
    envVars: getInput("env_vars"),
    serverTimeout: parseInt(getInput("server_timeout") || "30000", 10),
  };
}

/**
 * Set up language runtimes based on inputs
 */
async function setupLanguages(inputs: ActionInputs): Promise<void> {
  // We rely on composite action setup or assume runtimes are available
  // In a pure Node action, we'd need to install these ourselves or
  // require the user to set them up in a prior step

  core.info("📦 Verifying language runtimes...");

  if (inputs.setupNode) {
    try {
      let output = "";
      await exec.exec("node", ["--version"], {
        silent: true,
        listeners: {
          stdout: (data) => {
            output += data.toString();
          },
        },
      });
      core.info(`  Node.js: ${output.trim()}`);
    } catch {
      core.warning("Node.js not available - please set up in a prior step");
    }
  }

  if (inputs.setupPython) {
    try {
      let output = "";
      await exec.exec("python", ["--version"], {
        silent: true,
        listeners: {
          stdout: (data) => {
            output += data.toString();
          },
        },
      });
      core.info(`  Python: ${output.trim()}`);
    } catch {
      core.warning("Python not available - please set up in a prior step");
    }
  }

  if (inputs.setupGo) {
    try {
      let output = "";
      await exec.exec("go", ["version"], {
        silent: true,
        listeners: {
          stdout: (data) => {
            output += data.toString();
          },
        },
      });
      core.info(`  Go: ${output.trim()}`);
    } catch {
      core.warning("Go not available - please set up in a prior step");
    }
  }

  if (inputs.setupRust) {
    try {
      let output = "";
      await exec.exec("rustc", ["--version"], {
        silent: true,
        listeners: {
          stdout: (data) => {
            output += data.toString();
          },
        },
      });
      core.info(`  Rust: ${output.trim()}`);
    } catch {
      core.warning("Rust not available - please set up in a prior step");
    }
  }

  if (inputs.setupDotnet) {
    try {
      let output = "";
      await exec.exec("dotnet", ["--version"], {
        silent: true,
        listeners: {
          stdout: (data) => {
            output += data.toString();
          },
        },
      });
      core.info(`  .NET: ${output.trim()}`);
    } catch {
      core.warning(".NET not available - please set up in a prior step");
    }
  }
}

/**
 * Run initial build for current branch
 */
async function runInitialBuild(inputs: ActionInputs): Promise<void> {
  core.info("🔨 Running initial build...");

  if (inputs.installCommand) {
    core.info(`  Install: ${inputs.installCommand}`);
    await exec.exec("sh", ["-c", inputs.installCommand]);
  }

  if (inputs.buildCommand) {
    core.info(`  Build: ${inputs.buildCommand}`);
    await exec.exec("sh", ["-c", inputs.buildCommand]);
  }
}

/**
 * Main action entry point
 */
async function run(): Promise<void> {
  try {
    core.info("🚀 MCP Conformance Action");
    core.info("");

    // Get inputs
    const inputs = getInputs();

    core.info(`📋 Configuration:`);
    core.info(`  Transport: ${inputs.transport}`);
    core.info(`  Configurations: ${inputs.configurations.length}`);
    for (const config of inputs.configurations) {
      core.info(`    - ${config.name} (${config.transport})`);
    }

    // Set up languages
    await setupLanguages(inputs);

    // Run initial build
    await runInitialBuild(inputs);

    // Determine comparison ref
    const currentBranch = await getCurrentBranch();
    const compareRef = await determineCompareRef(inputs.compareRef, process.env.GITHUB_REF);

    core.info("");
    core.info(`📊 Comparison:`);
    core.info(`  Current: ${currentBranch}`);
    core.info(`  Compare: ${compareRef}`);

    // Run all tests
    core.info("");
    core.info("🧪 Running conformance tests...");

    const workDir = process.cwd();
    const results = await runAllTests({
      workDir,
      inputs,
      compareRef,
    });

    // Generate and save report
    core.info("");
    core.info("📝 Generating report...");

    const report = generateReport(results, currentBranch, compareRef);
    const markdown = generateMarkdownReport(report);
    saveReport(report, markdown, workDir);

    // Set final status
    core.info("");

    // Check for actual probe errors (separate from differences)
    const hasErrors = results.some((r) => r.diffs.has("error"));

    if (hasErrors && inputs.failOnError) {
      const errorConfigs = results.filter((r) => r.diffs.has("error")).map((r) => r.configName);
      core.setFailed(`❌ Probe errors occurred in: ${errorConfigs.join(", ")}`);
    } else if (report.diffCount > 0) {
      core.warning(`⚠️ ${report.diffCount} configuration(s) have API differences`);
      if (hasErrors) {
        core.warning("Some configurations had probe errors (fail_on_error is disabled)");
      }
    } else {
      core.info("✅ All conformance tests passed!");
    }
  } catch (error) {
    core.setFailed(`Action failed: ${error}`);
  }
}

// Run the action
run();
