export declare const COMMENT_MARKER = "<!-- mcp-server-diff -->";
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
export declare function buildCommentBody(report: string, links: CommentLinks): string;
export declare function upsertPullRequestComment(options: PullRequestCommentOptions): Promise<void>;
