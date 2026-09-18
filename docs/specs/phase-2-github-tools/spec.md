# Phase 2 Specification: Read-Only GitHub PR Tools

## Status

Implemented locally on September 16, 2026. Public PR retrieval is verified without a token; private repository access requires a server-side read-only token.

## Problem

Phase 1 accepts a pasted diff, but a real review workflow starts from a GitHub Pull Request. The Agent needs carefully bounded, read-only access to PR metadata, changed files, patches, and selected file content.

## User Story

As a developer, I want to enter a GitHub repository and PR number, preview the review context selected by the application, and make the same read-only capabilities available to the Mastra review agent.

## Scope

In scope:

- Read PR metadata from the GitHub REST API.
- List changed PR files with pagination bounds.
- Select reviewable source files and exclude generated, dependency, binary, lock, and oversized files.
- Fetch selected text file content only from the PR head SHA.
- Register typed read-only Mastra tools on the PR review agent.
- Expose a server API route for previewing the selected context without a model call.
- Support public repositories without a token and private repositories with `GITHUB_TOKEN`.

Out of scope:

- Creating comments, reviews, commits, branches, labels, or any other GitHub mutation.
- Arbitrary URL fetching, repository cloning, shell execution, and full repository indexing.
- Model-driven tool execution UI and workflow orchestration.
- Authentication for multiple end users.

## Input Contract

```ts
type PullRequestTarget = {
  owner: string;
  repo: string;
  pullNumber: number;
};
```

Constraints:

- `owner` and `repo` must be GitHub-safe path segments, 1-100 characters.
- `pullNumber` must be a positive integer.
- API base URL is fixed in server code; callers cannot supply a URL, ref, access token, or arbitrary file path.

## Output Contract

```ts
type PullRequestContext = {
  pullRequest: {
    number: number;
    title: string;
    body: string | null;
    state: "open" | "closed";
    headSha: string;
    baseRef: string;
    headRef: string;
    changedFiles: number;
    additions: number;
    deletions: number;
    htmlUrl: string;
  };
  selectedFiles: Array<{
    path: string;
    status: "added" | "modified" | "removed" | "renamed" | "copied" | "changed";
    additions: number;
    deletions: number;
    patch: string | null;
    content: string | null;
    selectionReason: string;
  }>;
  skippedFiles: Array<{
    path: string;
    reason: string;
  }>;
  limits: {
    filesFetched: number;
    filesSelected: number;
    patchCharacters: number;
  };
};
```

## Behavior

1. The server validates `owner`, `repo`, and `pullNumber`.
2. The GitHub client reads PR metadata and at most 100 changed-file records.
3. The selector excludes non-reviewable paths and stops at file/patch budgets.
4. Selected files are read only at the PR head SHA, with a per-file content cap.
5. The route returns a stable JSON preview; Mastra tools expose the same narrow capabilities to the Agent.
6. GitHub errors are mapped to safe application errors without returning tokens or raw headers.

## Acceptance Criteria

- A public PR can be fetched without exposing `GITHUB_TOKEN`.
- A private PR can be fetched when the server has an appropriate read token.
- Invalid target fields are rejected before any GitHub request.
- The client cannot choose a host, ref, token, or arbitrary file path.
- Lock files, generated files, binary assets, and oversized content are skipped with a reason.
- At least one test covers target validation, one covers file filtering, and one covers GitHub error mapping.
- `npm run verify` passes.

## Safety Requirements

- Only `GET` requests to `https://api.github.com` are allowed.
- `GITHUB_TOKEN` is read only on the server and never returned.
- Request headers use a GitHub API version and an explicit User-Agent.
- Tool output is capped before it reaches the model context.
- GitHub text is treated as untrusted content by later review prompts.
