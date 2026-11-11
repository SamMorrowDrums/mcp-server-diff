import * as core from "@actions/core";
import * as fs from "node:fs";
import { buildCommentBody, upsertPullRequestComment } from "./comment-api.js";

async function run(): Promise<void> {
  const token = core.getInput("github_token", { required: true });
  const repository = process.env.GITHUB_REPOSITORY || "";
  const pullRequestNumber = Number(core.getInput("pull_request_number", { required: true }));
  const reportPath = core.getInput("report_path", { required: true });
  const report = fs.readFileSync(reportPath, "utf8");
  const serverUrl = (process.env.GITHUB_SERVER_URL || "https://github.com").replace(/\/+$/, "");
  const runId = process.env.GITHUB_RUN_ID;
  if (!repository || !runId) {
    throw new Error("GITHUB_REPOSITORY and GITHUB_RUN_ID must be set by GitHub Actions");
  }

  const artifactUrl = core.getInput("artifact_url");
  if (artifactUrl && new URL(artifactUrl).origin !== new URL(serverUrl).origin) {
    throw new Error("Report artifact URL must use the current GitHub server");
  }

  const body = buildCommentBody(report, {
    runUrl: `${serverUrl}/${repository}/actions/runs/${runId}`,
    ...(artifactUrl ? { artifactUrl } : {}),
  });
  await upsertPullRequestComment({
    token,
    repository,
    pullRequestNumber,
    commentAuthor: core.getInput("comment_author") || undefined,
    body,
    apiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
  });
  core.info(`Updated MCP diff comment on ${repository}#${pullRequestNumber}`);
}

run().catch((error: unknown) => {
  core.setFailed(`Failed to update MCP diff pull request comment: ${error}`);
});
