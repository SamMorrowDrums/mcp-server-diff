/**
 * Report generator for MCP server diff
 */
import type { TestResult, ConformanceReport } from "./types.js";
/**
 * Generate a diff report from test results
 */
export declare function generateReport(results: TestResult[], currentBranch: string, compareRef: string): ConformanceReport;
/**
 * Generate markdown report
 */
export declare function generateMarkdownReport(report: ConformanceReport): string;
/**
 * Build a banner string flagging that the MCP protocol version differs
 * between the base and branch probes. Returns `null` when the versions match
 * (or either side is unknown). The normalizer already scrubs protocol-shaped
 * noise from the diff body, so this banner exists purely to give reviewers
 * context for any leftover changes.
 */
export declare function formatProtocolVersionBanner(result: TestResult): string | null;
/**
 * Save report to file and set outputs
 */
export declare function saveReport(report: ConformanceReport, markdown: string, outputDir: string): void;
/**
 * Write a simple summary for PR comments
 */
export declare function generatePRSummary(report: ConformanceReport): string;
