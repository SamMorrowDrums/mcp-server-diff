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
 * Save report to file and set outputs
 */
export declare function saveReport(report: ConformanceReport, markdown: string, outputDir: string): void;
/**
 * Write a simple summary for PR comments
 */
export declare function generatePRSummary(report: ConformanceReport): string;
