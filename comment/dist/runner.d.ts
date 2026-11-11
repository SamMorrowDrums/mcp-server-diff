/**
 * Test runner for MCP server diff
 */
import type { TestConfiguration, ActionInputs, TestResult, ProbeResult, CustomMessage } from "./types.js";
interface RunContext {
    workDir: string;
    inputs: ActionInputs;
    compareRef: string;
}
/**
 * Parse configurations from input
 */
export declare function parseConfigurations(input: string | undefined, defaultTransport: "stdio" | "streamable-http", defaultCommand: string, defaultUrl: string): TestConfiguration[];
/**
 * Parse custom messages from input
 */
export declare function parseCustomMessages(input: string | undefined): CustomMessage[];
/**
 * Parse headers from input (JSON object or KEY=value format, newline separated)
 */
export declare function parseHeaders(input: string | undefined): Record<string, string>;
/**
 * Parse environment variables from string (KEY=value format, newline separated)
 */
export declare function parseEnvVars(input?: string): Record<string, string>;
/**
 * Outcome of comparing one configuration's probe results across both sides.
 */
export interface ComparisonOutcome {
    /** Endpoint -> diff/marker map (may include "error" or "config-missing" keys) */
    diffs: Map<string, string>;
    /** Present when exactly one side failed to start */
    configMissing?: {
        side: "branch" | "base";
        error: string;
    };
    /**
     * True only for genuine probe failures (both sides failed to start). When
     * true the "error" key is set and the run should honor fail_on_error.
     */
    fatalError: boolean;
}
/**
 * Compare a single configuration's branch/base probe results, handling the
 * three startup outcomes:
 *
 * - Both sides failed to start -> genuine probe error (fatal).
 * - Exactly one side failed to start -> treat the failed side as an empty
 *   probe result and diff the working side against it, so its entire surface
 *   renders as added/removed. Non-fatal; tagged with a "config-missing" note
 *   naming the side that could not start.
 * - Neither side errored -> normal comparison.
 */
export declare function compareConfigResults(configName: string, branchResult: ProbeResult | undefined, baseResult: ProbeResult | undefined, compareRef: string): ComparisonOutcome;
/**
 * Run all diff tests using the "probe all, then compare" approach
 */
export declare function runAllTests(ctx: RunContext): Promise<TestResult[]>;
export {};
