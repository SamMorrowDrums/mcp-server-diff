/**
 * Report generator for MCP server diff
 */

import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";
import type { TestResult, ConformanceReport } from "./types.js";

/** A result that failed to start on exactly one side (diffed against empty). */
function isConfigMissing(result: TestResult): boolean {
  return !!result.configMissing || result.diffs.has("config-missing");
}

/** A result with a genuine probe error (both sides failed to start). */
function isErrored(result: TestResult): boolean {
  return !isConfigMissing(result) && (!!result.error || result.diffs.has("error"));
}

/** A result with real API changes (not an error, not a one-sided missing config). */
function isChanged(result: TestResult): boolean {
  return result.hasDifferences && !isErrored(result) && !isConfigMissing(result);
}

/** A result with no differences, errors, or missing-config markers. */
function isPassing(result: TestResult): boolean {
  return !result.hasDifferences && !isErrored(result) && !isConfigMissing(result);
}

/** Human-readable label for the side that failed to start. */
function missingSideLabel(report: ConformanceReport, result: TestResult): string {
  const side = result.configMissing?.side;
  if (side === "branch") {
    return `current branch (${report.currentBranch})`;
  }
  return `compare ref (${report.compareRef})`;
}

/**
 * Generate a diff report from test results
 */
export function generateReport(
  results: TestResult[],
  currentBranch: string,
  compareRef: string
): ConformanceReport {
  const totalBranchTime = results.reduce((sum, r) => sum + r.branchTime, 0);
  const totalBaseTime = results.reduce((sum, r) => sum + r.baseTime, 0);
  const passedCount = results.filter((r) => !r.hasDifferences).length;
  const diffCount = results.filter((r) => r.hasDifferences).length;

  return {
    generatedAt: new Date().toISOString(),
    currentBranch,
    compareRef,
    results,
    totalBranchTime,
    totalBaseTime,
    passedCount,
    diffCount,
  };
}

/**
 * Generate markdown report
 */
export function generateMarkdownReport(report: ConformanceReport): string {
  const lines: string[] = [];

  lines.push("# MCP Conformance Test Report");
  lines.push("");
  lines.push(`**Generated:** ${report.generatedAt}`);
  lines.push(`**Current Branch:** ${report.currentBranch}`);
  lines.push(`**Compared Against:** ${report.compareRef}`);
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Configurations | ${report.results.length} |`);
  lines.push(`| Passed | ${report.passedCount} |`);
  lines.push(`| With Differences | ${report.diffCount} |`);
  lines.push(`| Branch Total Time | ${formatTime(report.totalBranchTime)} |`);
  lines.push(`| Base Total Time | ${formatTime(report.totalBaseTime)} |`);
  lines.push("");

  // Overall status with passing and failing configurations
  if (report.diffCount === 0) {
    lines.push("## ✅ No API Changes");
    lines.push("");
    lines.push("All configurations passed with no differences detected.");
    lines.push("");
    lines.push("**✅ Passing configurations (no changes detected):**");
    for (const result of report.results) {
      if (isPassing(result)) {
        lines.push(`- ${result.configName}`);
      }
    }
  } else {
    lines.push("## 📋 API Changes Detected");
    lines.push("");

    // List passing configurations first
    const passingConfigs = report.results.filter(isPassing);
    if (passingConfigs.length > 0) {
      lines.push("**✅ Passing configurations (no changes detected):**");
      for (const result of passingConfigs) {
        lines.push(`- ${result.configName}`);
      }
      lines.push("");
    }

    // List configurations with changes (excluding errors and missing configs)
    const changedConfigs = report.results.filter(isChanged);
    if (changedConfigs.length > 0) {
      lines.push("**⚠️ Configurations with changes:**");
      for (const result of changedConfigs) {
        lines.push(`- ${result.configName} (see diff below)`);
      }
      lines.push("");
    }

    // List configurations that did not start on one side (diffed against empty)
    const missingConfigs = report.results.filter(isConfigMissing);
    if (missingConfigs.length > 0) {
      lines.push("**🚫 Configurations missing on one side (diffed against an empty baseline):**");
      for (const result of missingConfigs) {
        lines.push(`- ${result.configName} — did not start on ${missingSideLabel(report, result)}`);
      }
      lines.push("");
    }

    // List configurations with errors if any
    const errorConfigs = report.results.filter(isErrored);
    if (errorConfigs.length > 0) {
      lines.push("**❌ Configurations with errors:**");
      for (const result of errorConfigs) {
        lines.push(`- ${result.configName}`);
      }
    }
  }
  lines.push("");

  // Per-configuration results
  lines.push("## Configuration Results");
  lines.push("");

  for (const result of report.results) {
    const missing = isConfigMissing(result);
    const errored = isErrored(result);
    const statusIcon = errored ? "❌" : missing ? "🚫" : result.hasDifferences ? "⚠️" : "✅";
    lines.push(`### ${statusIcon} ${result.configName}`);
    lines.push("");
    lines.push(`- **Transport:** ${result.transport}`);

    // Show primitive counts if available
    if (result.branchCounts) {
      const counts = result.branchCounts;
      const countParts: string[] = [];
      if (counts.tools > 0) countParts.push(`${counts.tools} tools`);
      if (counts.prompts > 0) countParts.push(`${counts.prompts} prompts`);
      if (counts.resources > 0) countParts.push(`${counts.resources} resources`);
      if (counts.resourceTemplates > 0)
        countParts.push(`${counts.resourceTemplates} resource templates`);
      if (countParts.length > 0) {
        lines.push(`- **Primitives:** ${countParts.join(", ")}`);
      }
    }

    lines.push(`- **Branch Time:** ${formatTime(result.branchTime)}`);
    lines.push(`- **Base Time:** ${formatTime(result.baseTime)}`);
    lines.push("");

    // Surface protocol-version drift up front so reviewers know to expect
    // (and ignore) protocol-shaped noise. Cross-version normalization keeps
    // the diff itself clean, but the version change itself is worth flagging.
    const protocolBanner = formatProtocolVersionBanner(result);
    if (protocolBanner) {
      lines.push(protocolBanner);
      lines.push("");
    }

    // Callout for one-sided startup failure
    if (missing) {
      const note = result.diffs.get("config-missing");
      lines.push(`> 🚫 **Did not start on ${missingSideLabel(report, result)}.**`);
      if (note) {
        lines.push(`>`);
        lines.push(`> ${note}`);
      }
      if (result.configMissing?.error) {
        lines.push(`>`);
        lines.push(`> Startup error: \`${result.configMissing.error}\``);
      }
      lines.push("");
    }

    if (result.hasDifferences) {
      lines.push("#### Changes");
      lines.push("");

      for (const [endpoint, diff] of result.diffs) {
        // The config-missing marker is rendered as a callout above, not a diff block.
        if (endpoint === "config-missing") continue;
        lines.push(`**${endpoint}**`);
        lines.push("");
        lines.push("```diff");
        lines.push(diff);
        lines.push("```");
        lines.push("");
      }
    } else {
      lines.push("No differences detected.");
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Format milliseconds to human readable time
 */
function formatTime(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = (ms / 1000).toFixed(2);
  return `${seconds}s`;
}

/**
 * Build a banner string flagging that the MCP protocol version differs
 * between the base and branch probes. Returns `null` when the versions match
 * (or either side is unknown). The normalizer already scrubs protocol-shaped
 * noise from the diff body, so this banner exists purely to give reviewers
 * context for any leftover changes.
 */
export function formatProtocolVersionBanner(result: TestResult): string | null {
  const base = result.baseProtocolVersion;
  const branch = result.branchProtocolVersion;
  if (!base || !branch || base === branch) {
    return null;
  }
  return `> ℹ️ **MCP protocol version changed:** \`${base}\` → \`${branch}\`. Protocol-level plumbing (\`_meta\` keys, cache hints, \`capabilities.experimental\`) is normalized away; any diff below reflects real public-surface changes.`;
}

/**
 * Save report to file and set outputs
 */
export function saveReport(report: ConformanceReport, markdown: string, outputDir: string): void {
  // Ensure output directory exists
  const reportDir = path.join(outputDir, "mcp-diff-report");
  fs.mkdirSync(reportDir, { recursive: true });

  // Save JSON report
  const jsonPath = path.join(reportDir, "mcp-diff-report.json");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        ...report,
        results: report.results.map((r) => ({
          ...r,
          diffs: Object.fromEntries(r.diffs),
        })),
      },
      null,
      2
    )
  );
  core.info(`📄 JSON report saved to: ${jsonPath}`);

  // Save markdown report
  const mdPath = path.join(reportDir, "MCP_DIFF_REPORT.md");
  fs.writeFileSync(mdPath, markdown);
  core.info(`📄 Markdown report saved to: ${mdPath}`);

  // Set outputs using GITHUB_OUTPUT file (for composite actions)
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    const status = report.diffCount > 0 ? "differences" : "passed";
    fs.appendFileSync(githubOutput, `status=${status}\n`);
    fs.appendFileSync(githubOutput, `report_path=${mdPath}\n`);
    fs.appendFileSync(githubOutput, `json_report_path=${jsonPath}\n`);
    fs.appendFileSync(githubOutput, `has_differences=${report.diffCount > 0}\n`);
    fs.appendFileSync(githubOutput, `passed_count=${report.passedCount}\n`);
    fs.appendFileSync(githubOutput, `diff_count=${report.diffCount}\n`);
    fs.appendFileSync(githubOutput, `total_configs=${report.results.length}\n`);
  }

  // Also set via core for compatibility
  core.setOutput("report_path", mdPath);
  core.setOutput("json_report_path", jsonPath);
  core.setOutput("has_differences", report.diffCount > 0);
  core.setOutput("passed_count", report.passedCount);
  core.setOutput("diff_count", report.diffCount);
  core.setOutput("total_configs", report.results.length);
}

/**
 * Write a simple summary for PR comments
 */
export function generatePRSummary(report: ConformanceReport): string {
  const lines: string[] = [];

  // Surface protocol-version drift at the very top of the PR summary so
  // reviewers immediately know the diff was taken across spec revisions.
  const versionDriftLines: string[] = [];
  for (const r of report.results) {
    const banner = formatProtocolVersionBanner(r);
    if (banner) {
      versionDriftLines.push(
        `- **${r.configName}:** \`${r.baseProtocolVersion}\` → \`${r.branchProtocolVersion}\``
      );
    }
  }
  if (versionDriftLines.length > 0) {
    lines.push("> ℹ️ **MCP protocol version changed in one or more configurations:**");
    for (const v of versionDriftLines) lines.push(`> ${v}`);
    lines.push(">");
    lines.push(
      "> Protocol-level plumbing is normalized away; any diff below reflects real public-surface changes."
    );
    lines.push("");
  }

  if (report.diffCount === 0) {
    lines.push("## ✅ MCP Conformance: No Changes");
    lines.push("");
    lines.push(`Tested ${report.results.length} configuration(s) - no API changes detected.`);
    lines.push("");
    lines.push("**✅ Passing configurations:**");
    for (const result of report.results.filter(isPassing)) {
      lines.push(`- ${result.configName}`);
    }
  } else {
    lines.push("## 📋 MCP Conformance: API Changes Detected");
    lines.push("");
    lines.push(
      `**${report.diffCount}** of ${report.results.length} configuration(s) have changes.`
    );
    lines.push("");

    // List passing configurations
    const passingConfigs = report.results.filter(isPassing);
    if (passingConfigs.length > 0) {
      lines.push("**✅ Passing configurations (no changes):**");
      for (const result of passingConfigs) {
        lines.push(`- ${result.configName}`);
      }
      lines.push("");
    }

    // List configurations with changes (excluding errors and missing configs)
    const changedConfigs = report.results.filter(isChanged);
    if (changedConfigs.length > 0) {
      lines.push("**⚠️ Changed configurations:**");
      for (const result of changedConfigs) {
        lines.push(`- **${result.configName}:** ${Array.from(result.diffs.keys()).join(", ")}`);
      }
      lines.push("");
    }

    // List configurations that did not start on one side (diffed against empty)
    const missingConfigs = report.results.filter(isConfigMissing);
    if (missingConfigs.length > 0) {
      lines.push("**🚫 Missing on one side (diffed against an empty baseline):**");
      for (const result of missingConfigs) {
        lines.push(
          `- **${result.configName}:** did not start on ${missingSideLabel(report, result)}`
        );
      }
      lines.push("");
    }

    // List configurations with errors if any
    const errorConfigs = report.results.filter(isErrored);
    if (errorConfigs.length > 0) {
      lines.push("**❌ Configurations with errors:**");
      for (const result of errorConfigs) {
        lines.push(`- ${result.configName}`);
      }
      lines.push("");
    }

    lines.push("See the full report in the job summary for details.");
  }

  return lines.join("\n");
}
