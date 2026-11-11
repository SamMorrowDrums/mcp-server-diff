export const COMMENT_MARKER = "<!-- mcp-server-diff -->";

interface GitHubIssueComment {
  id: number;
  body?: string | null;
  user?: { login?: string | null } | null;
}

export interface PullRequestCommentOptions {
  token: string;
  repository: string;
  pullRequestNumber: number;
  commentAuthor?: string;
  body: string;
  apiUrl: string;
  fetchImpl?: typeof fetch;
}

export interface CommentLinks {
  runUrl: string;
  artifactUrl?: string;
}

function repositoryPath(repository: string): string {
  const parts = repository.split("/");
  if (parts.length !== 2 || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Invalid repository name: ${repository}`);
  }
  return parts.map(encodeURIComponent).join("/");
}

function endpoint(apiUrl: string, path: string): string {
  const base = new URL(`${apiUrl.replace(/\/+$/, "")}/`);
  return new URL(path, base).toString();
}

async function assertResponse(response: Response): Promise<void> {
  if (response.ok) return;
  const detail = (await response.text()).slice(0, 500);
  throw new Error(`GitHub API request failed (${response.status})${detail ? `: ${detail}` : ""}`);
}

async function findExistingComment(
  requestUrl: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  commentAuthor: string
): Promise<number | null> {
  let page = 1;
  while (true) {
    const url = new URL(requestUrl);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const response = await fetchImpl(url.toString(), { headers });
    await assertResponse(response);
    const comments: unknown = await response.json();
    if (!Array.isArray(comments)) {
      throw new Error("GitHub API returned an invalid pull request comments list");
    }

    const existing = (comments as GitHubIssueComment[]).find(
      (comment) =>
        comment.user?.login === commentAuthor &&
        typeof comment.body === "string" &&
        comment.body.startsWith(COMMENT_MARKER)
    );
    if (existing) return existing.id;
    if (comments.length < 100) return null;
    page += 1;
  }
}

export function buildCommentBody(report: string, links: CommentLinks): string {
  const maxReportLength = 55_000;
  const content =
    report.length > maxReportLength
      ? `${report.slice(0, maxReportLength)}\n\n_Report truncated; see the full report artifact._`
      : report;
  const lines = [COMMENT_MARKER, "", `[View the Actions run and summary](${links.runUrl})`];
  if (links.artifactUrl) {
    lines.push(`[Download the full report artifact](${links.artifactUrl})`);
  }
  lines.push("", content);
  return lines.join("\n");
}

export async function upsertPullRequestComment(options: PullRequestCommentOptions): Promise<void> {
  if (!options.token) throw new Error("A GitHub token is required");
  if (!Number.isSafeInteger(options.pullRequestNumber) || options.pullRequestNumber < 1) {
    throw new Error("Pull request number must be a positive integer");
  }
  if (!options.body.startsWith(COMMENT_MARKER)) {
    throw new Error("Pull request comment body must start with the action marker");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const commentAuthor = options.commentAuthor || "github-actions[bot]";
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${options.token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
  const commentsUrl = endpoint(
    options.apiUrl,
    `repos/${repositoryPath(options.repository)}/issues/${options.pullRequestNumber}/comments`
  );
  const existingCommentId = await findExistingComment(
    commentsUrl,
    headers,
    fetchImpl,
    commentAuthor
  );
  const url = existingCommentId
    ? endpoint(
        options.apiUrl,
        `repos/${repositoryPath(options.repository)}/issues/comments/${existingCommentId}`
      )
    : commentsUrl;
  const response = await fetchImpl(url, {
    method: existingCommentId ? "PATCH" : "POST",
    headers,
    body: JSON.stringify({ body: options.body }),
  });
  await assertResponse(response);
}
