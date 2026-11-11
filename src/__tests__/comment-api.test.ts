import { jest } from "@jest/globals";
import { buildCommentBody, COMMENT_MARKER, upsertPullRequestComment } from "../comment-api.js";

describe("buildCommentBody", () => {
  it("links to the run summary and report artifact", () => {
    const body = buildCommentBody("# MCP diff", {
      runUrl: "https://github.com/acme/server/actions/runs/123",
      artifactUrl: "https://github.com/acme/server/actions/runs/123/artifacts/456",
    });

    expect(body).toContain(COMMENT_MARKER);
    expect(body).toContain("[View the Actions run and summary]");
    expect(body).toContain("[Download the full report artifact]");
    expect(body).toContain("# MCP diff");
  });

  it("truncates oversized reports while retaining the artifact link", () => {
    const body = buildCommentBody("x".repeat(60_000), {
      runUrl: "https://github.com/acme/server/actions/runs/123",
      artifactUrl: "https://github.com/acme/server/actions/runs/123/artifacts/456",
    });

    expect(body.length).toBeLessThan(56_000);
    expect(body).toContain("_Report truncated; see the full report artifact._");
    expect(body).toContain("artifacts/456");
  });
});

describe("upsertPullRequestComment", () => {
  const baseOptions = {
    token: "test-token",
    repository: "acme/server",
    pullRequestNumber: 12,
    body: `${COMMENT_MARKER}\n\nDiff report`,
    apiUrl: "https://api.github.com",
  };

  it("creates a comment when no marked bot comment exists", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json({ id: 1 }));

    await upsertPullRequestComment({ ...baseOptions, fetchImpl });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/acme/server/issues/12/comments",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("updates the existing sticky bot comment", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json([
          {
            id: 77,
            body: `${COMMENT_MARKER}\nold report`,
            user: { login: "github-actions[bot]" },
          },
        ])
      )
      .mockResolvedValueOnce(Response.json({ id: 77 }));

    await upsertPullRequestComment({ ...baseOptions, fetchImpl });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/acme/server/issues/comments/77",
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("uses the configured comment author for custom tokens", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json([
          {
            id: 88,
            body: `${COMMENT_MARKER}\nold report`,
            user: { login: "mcp-diff[bot]" },
          },
        ])
      )
      .mockResolvedValueOnce(Response.json({ id: 88 }));

    await upsertPullRequestComment({
      ...baseOptions,
      commentAuthor: "mcp-diff[bot]",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/acme/server/issues/comments/88",
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("searches later pages before creating a duplicate", async () => {
    const firstPage = Array.from({ length: 100 }, (_, id) => ({
      id,
      body: "unrelated comment",
      user: { login: "github-actions[bot]" },
    }));
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(firstPage))
      .mockResolvedValueOnce(
        Response.json([
          {
            id: 99,
            body: COMMENT_MARKER,
            user: { login: "github-actions[bot]" },
          },
        ])
      )
      .mockResolvedValueOnce(Response.json({ id: 99 }));

    await upsertPullRequestComment({ ...baseOptions, fetchImpl });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "https://api.github.com/repos/acme/server/issues/comments/99",
      expect.objectContaining({ method: "PATCH" })
    );
  });
});
