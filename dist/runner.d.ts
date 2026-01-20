/**
 * Test runner for MCP server diff
 */
import type { TestConfiguration, ActionInputs, TestResult, CustomMessage } from "./types.js";
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
 * Run all diff tests using the "probe all, then compare" approach
 */
export declare function runAllTests(ctx: RunContext): Promise<TestResult[]>;
export {};
