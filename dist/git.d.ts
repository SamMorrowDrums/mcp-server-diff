/**
 * Git utilities for MCP server diff
 */
export interface GitInfo {
    currentBranch: string;
    compareRef: string;
}
/**
 * Get current branch name
 */
export declare function getCurrentBranch(): Promise<string>;
/**
 * Determine what ref to compare against
 * Priority: 1) Explicit compare_ref, 2) Auto-detect previous tag, 3) Merge-base with main
 */
export declare function determineCompareRef(explicitRef?: string, githubRef?: string): Promise<string>;
/**
 * Create a worktree for the compare ref
 */
export declare function createWorktree(ref: string, path: string): Promise<boolean>;
/**
 * Remove a worktree
 */
export declare function removeWorktree(path: string): Promise<void>;
/**
 * Checkout a ref (fallback if worktree fails)
 */
export declare function checkout(ref: string): Promise<void>;
/**
 * Checkout previous branch/ref
 */
export declare function checkoutPrevious(): Promise<void>;
/**
 * Get a display-friendly name for a ref.
 * Returns branch/tag name if available, otherwise the short SHA.
 */
export declare function getRefDisplayName(ref: string): Promise<string>;
