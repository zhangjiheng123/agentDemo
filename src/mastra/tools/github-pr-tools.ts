import { createTool } from "@mastra/core/tools";

import {
  PullRequestContextSchema,
  PullRequestFilesPreviewSchema,
  PullRequestMetadataSchema,
  PullRequestTargetSchema,
  selectReviewableFiles,
} from "@/src/domain/github";
import { createGitHubClient } from "@/src/services/github/client";

export const getPullRequestTool = createTool({
  id: "get-pull-request",
  description:
    "Read metadata for one GitHub pull request. This tool is read-only and only accepts owner, repo, and pull number.",
  inputSchema: PullRequestTargetSchema,
  outputSchema: PullRequestMetadataSchema,
  execute: async ({ context }) => createGitHubClient().getPullRequest(context),
});

export const getPullRequestFilesTool = createTool({
  id: "get-pull-request-files",
  description:
    "Read and deterministically filter changed files for one GitHub pull request. This tool is read-only and returns selected plus skipped files.",
  inputSchema: PullRequestTargetSchema,
  outputSchema: PullRequestFilesPreviewSchema,
  execute: async ({ context }) => {
    const client = createGitHubClient();
    const files = await client.listPullRequestFiles(context);

    return selectReviewableFiles(files);
  },
});

export const getPullRequestContextTool = createTool({
  id: "get-pull-request-context",
  description:
    "Read bounded PR metadata, selected file patches, and selected file content at the pull request head SHA. This tool never writes to GitHub.",
  inputSchema: PullRequestTargetSchema,
  outputSchema: PullRequestContextSchema,
  execute: async ({ context }) => createGitHubClient().getPullRequestContext(context),
});

export const githubPullRequestTools = {
  getPullRequest: getPullRequestTool,
  getPullRequestFiles: getPullRequestFilesTool,
  getPullRequestContext: getPullRequestContextTool,
};
