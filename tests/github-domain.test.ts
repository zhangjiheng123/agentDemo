import assert from "node:assert/strict";
import test from "node:test";

import {
  PullRequestTargetSchema,
  mapGitHubError,
  selectReviewableFiles,
} from "../src/domain/github";
import { GitHubClient } from "../src/services/github/client";

test("rejects unsafe GitHub targets before a request can be made", () => {
  assert.equal(
    PullRequestTargetSchema.safeParse({
      owner: "octocat/other",
      repo: "hello-world",
      pullNumber: 1,
    }).success,
    false,
  );
  assert.equal(
    PullRequestTargetSchema.safeParse({
      owner: "octocat",
      repo: "hello-world",
      pullNumber: 0,
    }).success,
    false,
  );
});

test("selects source files and skips lock, generated, binary, and patchless files", () => {
  const preview = selectReviewableFiles([
    {
      path: "src/user.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
      patch: "+ export const name = 'Ada';",
    },
    {
      path: "package-lock.json",
      status: "modified",
      additions: 4,
      deletions: 4,
      patch: "+ lockfileVersion: 3",
    },
    {
      path: "dist/app.min.js",
      status: "modified",
      additions: 10,
      deletions: 5,
      patch: "+ minified",
    },
    {
      path: "public/logo.png",
      status: "added",
      additions: 0,
      deletions: 0,
      patch: null,
    },
    {
      path: "src/large.ts",
      status: "modified",
      additions: 0,
      deletions: 0,
      patch: null,
    },
  ]);

  assert.deepEqual(
    preview.selectedFiles.map((file) => file.path),
    ["src/user.ts"],
  );
  assert.equal(preview.skippedFiles.length, 4);
  assert.match(preview.skippedFiles[0]?.reason ?? "", /lock/i);
  assert.match(preview.skippedFiles[1]?.reason ?? "", /generated/i);
  assert.match(preview.skippedFiles[2]?.reason ?? "", /binary/i);
  assert.match(preview.skippedFiles[3]?.reason ?? "", /textual patch/i);
});

test("maps GitHub status codes to safe application errors", () => {
  const notFound = mapGitHubError(404);
  const rateLimited = mapGitHubError(403, "0");

  assert.equal(notFound.code, "not_found");
  assert.equal(notFound.status, 404);
  assert.equal(rateLimited.code, "rate_limited");
  assert.equal(rateLimited.status, 429);
});

test("reads selected content at the pull request head SHA", async () => {
  const requestedUrls: string[] = [];
  const mockFetch: typeof fetch = async (input) => {
    const url = input.toString();
    requestedUrls.push(url);

    if (url.includes("/pulls/42/files")) {
      return Response.json([
        {
          filename: "src/user.ts",
          status: "modified",
          additions: 2,
          deletions: 1,
          patch: "+ export const user = 'Ada';",
        },
      ]);
    }

    if (url.includes("/contents/src/user.ts?ref=head-sha-42")) {
      return Response.json({
        type: "file",
        encoding: "base64",
        content: Buffer.from("export const user = 'Ada';").toString("base64"),
      });
    }

    return Response.json({
      number: 42,
      title: "Add user",
      body: null,
      state: "open",
      head: { sha: "head-sha-42", ref: "feature/user" },
      base: { ref: "main" },
      changed_files: 1,
      additions: 2,
      deletions: 1,
      html_url: "https://github.com/octocat/hello-world/pull/42",
    });
  };

  const client = new GitHubClient({ fetchImplementation: mockFetch });
  const context = await client.getPullRequestContext({
    owner: "octocat",
    repo: "hello-world",
    pullNumber: 42,
  });

  assert.equal(context.selectedFiles[0]?.content, "export const user = 'Ada';");
  assert.equal(
    requestedUrls.some((url) => url.includes("/contents/src/user.ts?ref=head-sha-42")),
    true,
  );
});
