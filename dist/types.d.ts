/**
 * Type definitions for MCP Conformance Action
 */
export interface TestConfiguration {
    name: string;
    transport: "stdio" | "streamable-http";
    start_command?: string;
    args?: string;
    server_url?: string;
    headers?: Record<string, string>;
    env_vars?: string;
    custom_messages?: CustomMessage[];
    /** Command to run before starting the MCP server for this config */
    pre_test_command?: string;
    /** Milliseconds to wait after pre_test_command before starting the server */
    pre_test_wait_ms?: number;
    /** Milliseconds to wait for HTTP server to start (when using start_command with HTTP transport) */
    startup_wait_ms?: number;
    /** Command to run after stopping the MCP server for this config (cleanup) */
    post_test_command?: string;
}
export interface CustomMessage {
    id: number;
    name: string;
    message: Record<string, unknown>;
}
export interface ActionInputs {
    setupNode: boolean;
    nodeVersion: string;
    setupPython: boolean;
    pythonVersion: string;
    setupGo: boolean;
    goVersion: string;
    setupRust: boolean;
    rustToolchain: string;
    setupDotnet: boolean;
    dotnetVersion: string;
    installCommand: string;
    buildCommand: string;
    startCommand: string;
    transport: "stdio" | "streamable-http";
    serverUrl: string;
    headers: Record<string, string>;
    configurations: TestConfiguration[];
    customMessages: CustomMessage[];
    compareRef: string;
    failOnError: boolean;
    envVars: string;
    serverTimeout: number;
}
export interface ProbeResult {
    initialize: InitializeInfo | null;
    tools: ToolsResult | null;
    prompts: PromptsResult | null;
    resources: ResourcesResult | null;
    resourceTemplates: ResourceTemplatesResult | null;
    customResponses: Map<string, unknown>;
    error?: string;
}
export interface InitializeInfo {
    serverInfo?: {
        name: string;
        version: string;
    };
    capabilities?: Record<string, unknown>;
}
export interface ToolsResult {
    tools: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
    }>;
}
export interface PromptsResult {
    prompts: Array<{
        name: string;
        description?: string;
        arguments?: Array<{
            name: string;
            description?: string;
            required?: boolean;
        }>;
    }>;
}
export interface ResourcesResult {
    resources: Array<{
        uri: string;
        name: string;
        description?: string;
        mimeType?: string;
    }>;
}
export interface ResourceTemplatesResult {
    resourceTemplates: Array<{
        uriTemplate: string;
        name: string;
        description?: string;
        mimeType?: string;
    }>;
}
export interface TestResult {
    configName: string;
    transport: string;
    branchTime: number;
    baseTime: number;
    hasDifferences: boolean;
    diffs: Map<string, string>;
}
export interface ConformanceReport {
    generatedAt: string;
    currentBranch: string;
    compareRef: string;
    results: TestResult[];
    totalBranchTime: number;
    totalBaseTime: number;
    passedCount: number;
    diffCount: number;
}
