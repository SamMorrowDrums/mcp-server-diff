/**
 * Tests for report generation
 */

import { generateReport, generateMarkdownReport, generatePRSummary } from "../reporter.js";
import type { TestResult, ConformanceReport } from "../types.js";

describe("generateReport", () => {
  it("calculates passed and diff counts correctly", () => {
    const results: TestResult[] = [
      {
        configName: "config1",
        transport: "stdio",
        branchTime: 100,
        baseTime: 90,
        hasDifferences: false,
        diffs: new Map(),
      },
      {
        configName: "config2",
        transport: "stdio",
        branchTime: 120,
        baseTime: 110,
        hasDifferences: true,
        diffs: new Map([["tools", "diff content"]]),
      },
      {
        configName: "config3",
        transport: "streamable-http",
        branchTime: 80,
        baseTime: 85,
        hasDifferences: false,
        diffs: new Map(),
      },
    ];

    const report = generateReport(results, "main", "v1.0.0");

    expect(report.passedCount).toBe(2);
    expect(report.diffCount).toBe(1);
    expect(report.results.length).toBe(3);
    expect(report.totalBranchTime).toBe(300);
    expect(report.totalBaseTime).toBe(285);
  });
});

describe("generateMarkdownReport", () => {
  it("lists all passing configurations when no diffs", () => {
    const results: TestResult[] = [
      {
        configName: "config1",
        transport: "stdio",
        branchTime: 100,
        baseTime: 90,
        hasDifferences: false,
        diffs: new Map(),
      },
      {
        configName: "config2",
        transport: "streamable-http",
        branchTime: 120,
        baseTime: 110,
        hasDifferences: false,
        diffs: new Map(),
      },
    ];

    const report: ConformanceReport = {
      generatedAt: "2024-01-01T00:00:00.000Z",
      currentBranch: "main",
      compareRef: "v1.0.0",
      results,
      totalBranchTime: 220,
      totalBaseTime: 200,
      passedCount: 2,
      diffCount: 0,
    };

    const markdown = generateMarkdownReport(report);

    expect(markdown).toContain("## ✅ No API Changes");
    expect(markdown).toContain("All configurations passed with no differences detected");
    expect(markdown).toContain("**✅ Passing configurations (no changes detected):**");
    expect(markdown).toContain("- config1");
    expect(markdown).toContain("- config2");
  });

  it("separates passing and failing configurations when there are diffs", () => {
    const results: TestResult[] = [
      {
        configName: "default",
        transport: "stdio",
        branchTime: 100,
        baseTime: 90,
        hasDifferences: false,
        diffs: new Map(),
      },
      {
        configName: "read-only",
        transport: "stdio",
        branchTime: 95,
        baseTime: 88,
        hasDifferences: false,
        diffs: new Map(),
      },
      {
        configName: "toolsets-all",
        transport: "stdio",
        branchTime: 120,
        baseTime: 110,
        hasDifferences: true,
        diffs: new Map([["tools", "diff content"]]),
      },
      {
        configName: "http-server",
        transport: "streamable-http",
        branchTime: 130,
        baseTime: 125,
        hasDifferences: true,
        diffs: new Map([
          ["initialize", "server version changed"],
          ["resources", "new resource added"],
        ]),
      },
    ];

    const report: ConformanceReport = {
      generatedAt: "2024-01-01T00:00:00.000Z",
      currentBranch: "main",
      compareRef: "v1.0.0",
      results,
      totalBranchTime: 445,
      totalBaseTime: 413,
      passedCount: 2,
      diffCount: 2,
    };

    const markdown = generateMarkdownReport(report);

    expect(markdown).toContain("## 📋 API Changes Detected");
    expect(markdown).toContain("**✅ Passing configurations (no changes detected):**");
    expect(markdown).toContain("- default");
    expect(markdown).toContain("- read-only");
    expect(markdown).toContain("**⚠️ Configurations with changes:**");
    expect(markdown).toContain("- toolsets-all (see diff below)");
    expect(markdown).toContain("- http-server (see diff below)");
  });

  it("shows error configurations separately", () => {
    const results: TestResult[] = [
      {
        configName: "passing-config",
        transport: "stdio",
        branchTime: 100,
        baseTime: 90,
        hasDifferences: false,
        diffs: new Map(),
      },
      {
        configName: "error-config",
        transport: "stdio",
        branchTime: 0,
        baseTime: 0,
        hasDifferences: true,
        diffs: new Map([["error", "Failed to start server"]]),
      },
    ];

    const report: ConformanceReport = {
      generatedAt: "2024-01-01T00:00:00.000Z",
      currentBranch: "main",
      compareRef: "v1.0.0",
      results,
      totalBranchTime: 100,
      totalBaseTime: 90,
      passedCount: 1,
      diffCount: 1,
    };

    const markdown = generateMarkdownReport(report);

    expect(markdown).toContain("**✅ Passing configurations (no changes detected):**");
    expect(markdown).toContain("- passing-config");
    expect(markdown).toContain("**❌ Configurations with errors:**");
    expect(markdown).toContain("- error-config");
    // Error configs should not be in the changes section
    expect(markdown).not.toContain("error-config (see diff below)");
  });

  it("does not show empty sections", () => {
    const results: TestResult[] = [
      {
        configName: "config-with-diff",
        transport: "stdio",
        branchTime: 120,
        baseTime: 110,
        hasDifferences: true,
        diffs: new Map([["tools", "diff content"]]),
      },
    ];

    const report: ConformanceReport = {
      generatedAt: "2024-01-01T00:00:00.000Z",
      currentBranch: "main",
      compareRef: "v1.0.0",
      results,
      totalBranchTime: 120,
      totalBaseTime: 110,
      passedCount: 0,
      diffCount: 1,
    };

    const markdown = generateMarkdownReport(report);

    // Should not show passing configurations section when there are none
    expect(markdown).not.toContain("**✅ Passing configurations (no changes detected):**");
    expect(markdown).toContain("**⚠️ Configurations with changes:**");
    expect(markdown).toContain("- config-with-diff (see diff below)");
  });
});

describe("generatePRSummary", () => {
  it("lists passing configurations when no diffs", () => {
    const results: TestResult[] = [
      {
        configName: "config1",
        transport: "stdio",
        branchTime: 100,
        baseTime: 90,
        hasDifferences: false,
        diffs: new Map(),
      },
      {
        configName: "config2",
        transport: "stdio",
        branchTime: 120,
        baseTime: 110,
        hasDifferences: false,
        diffs: new Map(),
      },
    ];

    const report: ConformanceReport = {
      generatedAt: "2024-01-01T00:00:00.000Z",
      currentBranch: "main",
      compareRef: "v1.0.0",
      results,
      totalBranchTime: 220,
      totalBaseTime: 200,
      passedCount: 2,
      diffCount: 0,
    };

    const summary = generatePRSummary(report);

    expect(summary).toContain("## ✅ MCP Conformance: No Changes");
    expect(summary).toContain("Tested 2 configuration(s) - no API changes detected");
    expect(summary).toContain("**✅ Passing configurations:**");
    expect(summary).toContain("- config1");
    expect(summary).toContain("- config2");
  });

  it("shows both passing and changed configurations when there are diffs", () => {
    const results: TestResult[] = [
      {
        configName: "default",
        transport: "stdio",
        branchTime: 100,
        baseTime: 90,
        hasDifferences: false,
        diffs: new Map(),
      },
      {
        configName: "read-only",
        transport: "stdio",
        branchTime: 95,
        baseTime: 88,
        hasDifferences: false,
        diffs: new Map(),
      },
      {
        configName: "toolsets-all",
        transport: "stdio",
        branchTime: 120,
        baseTime: 110,
        hasDifferences: true,
        diffs: new Map([["tools", "diff content"]]),
      },
    ];

    const report: ConformanceReport = {
      generatedAt: "2024-01-01T00:00:00.000Z",
      currentBranch: "main",
      compareRef: "v1.0.0",
      results,
      totalBranchTime: 315,
      totalBaseTime: 288,
      passedCount: 2,
      diffCount: 1,
    };

    const summary = generatePRSummary(report);

    expect(summary).toContain("## 📋 MCP Conformance: API Changes Detected");
    expect(summary).toContain("**1** of 3 configuration(s) have changes");
    expect(summary).toContain("**✅ Passing configurations (no changes):**");
    expect(summary).toContain("- default");
    expect(summary).toContain("- read-only");
    expect(summary).toContain("**⚠️ Changed configurations:**");
    expect(summary).toContain("- **toolsets-all:** tools");
  });

  it("does not show passing section when all configs have diffs", () => {
    const results: TestResult[] = [
      {
        configName: "config1",
        transport: "stdio",
        branchTime: 100,
        baseTime: 90,
        hasDifferences: true,
        diffs: new Map([["tools", "diff content"]]),
      },
      {
        configName: "config2",
        transport: "stdio",
        branchTime: 120,
        baseTime: 110,
        hasDifferences: true,
        diffs: new Map([["initialize", "version changed"]]),
      },
    ];

    const report: ConformanceReport = {
      generatedAt: "2024-01-01T00:00:00.000Z",
      currentBranch: "main",
      compareRef: "v1.0.0",
      results,
      totalBranchTime: 220,
      totalBaseTime: 200,
      passedCount: 0,
      diffCount: 2,
    };

    const summary = generatePRSummary(report);

    expect(summary).not.toContain("**✅ Passing configurations");
    expect(summary).toContain("**⚠️ Changed configurations:**");
  });

  it("shows error configurations separately in PR summary", () => {
    const results: TestResult[] = [
      {
        configName: "passing-config",
        transport: "stdio",
        branchTime: 100,
        baseTime: 90,
        hasDifferences: false,
        diffs: new Map(),
      },
      {
        configName: "changed-config",
        transport: "stdio",
        branchTime: 120,
        baseTime: 110,
        hasDifferences: true,
        diffs: new Map([["tools", "diff content"]]),
      },
      {
        configName: "error-config",
        transport: "stdio",
        branchTime: 0,
        baseTime: 0,
        hasDifferences: true,
        diffs: new Map([["error", "Failed to start server"]]),
      },
    ];

    const report: ConformanceReport = {
      generatedAt: "2024-01-01T00:00:00.000Z",
      currentBranch: "main",
      compareRef: "v1.0.0",
      results,
      totalBranchTime: 220,
      totalBaseTime: 200,
      passedCount: 1,
      diffCount: 2,
    };

    const summary = generatePRSummary(report);

    expect(summary).toContain("**✅ Passing configurations (no changes):**");
    expect(summary).toContain("- passing-config");
    expect(summary).toContain("**⚠️ Changed configurations:**");
    expect(summary).toContain("- **changed-config:** tools");
    expect(summary).toContain("**❌ Configurations with errors:**");
    expect(summary).toContain("- error-config");
    // Error configs should not be in the changed section
    expect(summary).not.toContain("**error-config:**");
  });
});
