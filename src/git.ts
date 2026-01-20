/**
 * Git utilities for MCP server diff
 */

import * as exec from "@actions/exec";
import * as core from "@actions/core";

export interface GitInfo {
  currentBranch: string;
  compareRef: string;
}

/**
 * Get current branch name
 */
export async function getCurrentBranch(): Promise<string> {
  let output = "";
  try {
    await exec.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      silent: true,
      listeners: {
        stdout: (data) => {
          output += data.toString();
        },
      },
    });
    return output.trim() || "HEAD";
  } catch {
    return "HEAD";
  }
}

/**
 * Determine what ref to compare against
 * Priority: 1) Explicit compare_ref, 2) Auto-detect previous tag, 3) Merge-base with main
 */
export async function determineCompareRef(
  explicitRef?: string,
  githubRef?: string
): Promise<string> {
  // If explicit ref provided, use it
  if (explicitRef) {
    core.info(`Using explicit compare ref: ${explicitRef}`);
    return explicitRef;
  }

  // Check if this is a tag push
  if (githubRef?.startsWith("refs/tags/")) {
    const currentTag = githubRef.replace("refs/tags/", "");
    core.info(`Detected tag push: ${currentTag}`);

    // Try to find previous tag
    const previousTag = await findPreviousTag(currentTag);
    if (previousTag && previousTag !== currentTag) {
      core.info(`Auto-detected previous tag: ${previousTag}`);
      return previousTag;
    }

    // Fall back to first commit
    const firstCommit = await getFirstCommit();
    core.warning("No previous tag found, comparing against initial commit");
    return firstCommit;
  }

  // Default: find merge-base with main
  const baseRef = await findMainBranch();
  const mergeBase = await getMergeBase(baseRef);
  core.info(`Using merge-base with ${baseRef}: ${mergeBase}`);
  return mergeBase;
}

/**
 * Find the previous tag (sorted by version)
 */
async function findPreviousTag(currentTag: string): Promise<string | null> {
  let output = "";
  try {
    await exec.exec("git", ["tag", "--sort=-v:refname"], {
      silent: true,
      listeners: {
        stdout: (data) => {
          output += data.toString();
        },
      },
    });

    const tags = output.trim().split("\n");
    const currentIndex = tags.indexOf(currentTag);
    if (currentIndex >= 0 && currentIndex < tags.length - 1) {
      return tags[currentIndex + 1];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get the first commit in the repository
 */
async function getFirstCommit(): Promise<string> {
  let output = "";
  await exec.exec("git", ["rev-list", "--max-parents=0", "HEAD"], {
    silent: true,
    listeners: {
      stdout: (data) => {
        output += data.toString();
      },
    },
  });
  return output.trim().split("\n")[0];
}

/**
 * Find the main branch (origin/main, main, or first commit)
 */
async function findMainBranch(): Promise<string> {
  // Try origin/main
  try {
    await exec.exec("git", ["rev-parse", "--verify", "origin/main"], { silent: true });
    return "origin/main";
  } catch {
    // Try main
    try {
      await exec.exec("git", ["rev-parse", "--verify", "main"], { silent: true });
      return "main";
    } catch {
      // Fall back to first commit
      return await getFirstCommit();
    }
  }
}

/**
 * Get merge-base between HEAD and a ref
 */
async function getMergeBase(ref: string): Promise<string> {
  let output = "";
  try {
    await exec.exec("git", ["merge-base", "HEAD", ref], {
      silent: true,
      listeners: {
        stdout: (data) => {
          output += data.toString();
        },
      },
    });
    return output.trim();
  } catch {
    return ref;
  }
}

/**
 * Create a worktree for the compare ref
 */
export async function createWorktree(ref: string, path: string): Promise<boolean> {
  try {
    await exec.exec("git", ["worktree", "add", "--quiet", path, ref], { silent: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a worktree
 */
export async function removeWorktree(path: string): Promise<void> {
  try {
    await exec.exec("git", ["worktree", "remove", "--force", path], { silent: true });
  } catch {
    // Ignore errors
  }
}

/**
 * Checkout a ref (fallback if worktree fails)
 */
export async function checkout(ref: string): Promise<void> {
  await exec.exec("git", ["checkout", "--quiet", ref], { silent: true });
}

/**
 * Checkout previous branch/ref
 */
export async function checkoutPrevious(): Promise<void> {
  try {
    await exec.exec("git", ["checkout", "--quiet", "-"], { silent: true });
  } catch {
    // Ignore errors
  }
}

/**
 * Get a display-friendly name for a ref.
 * Returns branch/tag name if available, otherwise the short SHA.
 */
export async function getRefDisplayName(ref: string): Promise<string> {
  // If it's already a readable name (not a SHA), return it
  if (!ref.match(/^[a-f0-9]{40}$/i) && !ref.match(/^[a-f0-9]{7,}$/i)) {
    // It's likely already a branch/tag name
    return ref;
  }

  // Try to find a branch name pointing to this ref
  let output = "";
  try {
    await exec.exec("git", ["branch", "--points-at", ref, "--format=%(refname:short)"], {
      silent: true,
      listeners: {
        stdout: (data) => {
          output += data.toString();
        },
      },
    });
    const branches = output.trim().split("\n").filter(Boolean);
    if (branches.length > 0) {
      // Prefer main/master if available
      if (branches.includes("main")) return "main";
      if (branches.includes("master")) return "master";
      return branches[0];
    }
  } catch {
    // Ignore errors
  }

  // Try to find a tag pointing to this ref
  output = "";
  try {
    await exec.exec("git", ["tag", "--points-at", ref], {
      silent: true,
      listeners: {
        stdout: (data) => {
          output += data.toString();
        },
      },
    });
    const tags = output.trim().split("\n").filter(Boolean);
    if (tags.length > 0) {
      return tags[0];
    }
  } catch {
    // Ignore errors
  }

  // Fall back to short SHA
  output = "";
  try {
    await exec.exec("git", ["rev-parse", "--short", ref], {
      silent: true,
      listeners: {
        stdout: (data) => {
          output += data.toString();
        },
      },
    });
    return output.trim() || ref;
  } catch {
    return ref.substring(0, 7);
  }
}
