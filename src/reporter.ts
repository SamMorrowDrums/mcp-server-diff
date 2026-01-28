/**
 * Report generator for MCP server diff
 */

import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";
import type { TestResult, ConformanceReport } from "./types.js";

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
      if (!result.error && !result.diffs.has("error") && !result.hasDifferences) {
        lines.push(`- ${result.configName}`);
      }
    }
  } else {
    lines.push("## 📋 API Changes Detected");
    lines.push("");
    
    // List passing configurations first
    const passingConfigs = report.results.filter((r) => !r.error && !r.diffs.has("error") && !r.hasDifferences);
    if (passingConfigs.length > 0) {
      lines.push("**✅ Passing configurations (no changes detected):**");
      for (const result of passingConfigs) {
        lines.push(`- ${result.configName}`);
      }
      lines.push("");
    }
    
    // List configurations with changes (excluding errors)
    const changedConfigs = report.results.filter((r) => r.hasDifferences && !r.error && !r.diffs.has("error"));
    if (changedConfigs.length > 0) {
      lines.push("**⚠️ Configurations with changes:**");
      for (const result of changedConfigs) {
        lines.push(`- ${result.configName} (see diff below)`);
      }
      lines.push("");
    }
    
    // List configurations with errors if any
    const errorConfigs = report.results.filter((r) => r.error || r.diffs.has("error"));
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
    const statusIcon = result.error ? "❌" : result.hasDifferences ? "⚠️" : "✅";
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

    if (result.hasDifferences) {
      lines.push("#### Changes");
      lines.push("");

      for (const [endpoint, diff] of result.diffs) {
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

  if (report.diffCount === 0) {
    lines.push("## ✅ MCP Conformance: No Changes");
    lines.push("");
    lines.push(`Tested ${report.results.length} configuration(s) - no API changes detected.`);
    lines.push("");
    lines.push("**✅ Passing configurations:**");
    for (const result of report.results.filter((r) => !r.error && !r.diffs.has("error") && !r.hasDifferences)) {
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
    const passingConfigs = report.results.filter((r) => !r.error && !r.diffs.has("error") && !r.hasDifferences);
    if (passingConfigs.length > 0) {
      lines.push("**✅ Passing configurations (no changes):**");
      for (const result of passingConfigs) {
        lines.push(`- ${result.configName}`);
      }
      lines.push("");
    }
    
    // List configurations with changes (excluding errors)
    const changedConfigs = report.results.filter((r) => r.hasDifferences && !r.error && !r.diffs.has("error"));
    if (changedConfigs.length > 0) {
      lines.push("**⚠️ Changed configurations:**");
      for (const result of changedConfigs) {
        lines.push(`- **${result.configName}:** ${Array.from(result.diffs.keys()).join(", ")}`);
      }
      lines.push("");
    }

    // List configurations with errors if any
    const errorConfigs = report.results.filter((r) => r.error || r.diffs.has("error"));
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
