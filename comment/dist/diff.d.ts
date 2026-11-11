/**
 * Core diffing logic for MCP servers
 *
 * Pure functions for comparing probe results - no I/O side effects.
 */
import type { ProbeResult, PrimitiveCounts } from "./types.js";
export interface DiffResult {
    endpoint: string;
    diff: string;
}
export interface ComparisonResult {
    baseName: string;
    targetName: string;
    hasDifferences: boolean;
    diffs: DiffResult[];
    baseCounts: PrimitiveCounts;
    targetCounts: PrimitiveCounts;
    baseError?: string;
    targetError?: string;
}
/**
 * Extract primitive counts from a probe result
 */
export declare function extractCounts(result: ProbeResult): PrimitiveCounts;
/**
 * Compare two probe results and return structured diff results
 */
export declare function compareProbeResults(baseResult: ProbeResult, targetResult: ProbeResult): DiffResult[];
/**
 * Generate semantic JSON diff
 */
export declare function generateJsonDiff(name: string, base: string, target: string): string | null;
/**
 * Recursively find differences between two JSON objects
 */
export declare function findJsonDifferences(base: unknown, target: unknown, path: string): string[];
/**
 * Format a value for display in diff output
 */
export declare function formatValue(value: unknown): string;
/**
 * Convert DiffResult array to Map for backward compatibility
 */
export declare function diffsToMap(diffs: DiffResult[]): Map<string, string>;
