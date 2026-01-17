/**
 * Test runner for MCP conformance testing
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
 * Run conformance tests for a single configuration
 * @param useSharedServer - If true, skip per-config HTTP server management for CURRENT branch (shared server is running)
 * @param httpStartCommand - Command to start HTTP server for base ref testing (needed when using shared server)
 */
export declare function runSingleConfigTest(config: TestConfiguration, ctx: RunContext, useSharedServer?: boolean, httpStartCommand?: string): Promise<TestResult>;
/**
 * Run all conformance tests
 */
export declare function runAllTests(ctx: RunContext): Promise<TestResult[]>;
export {};
