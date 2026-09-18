# Phase 3 Specification: PR Review Workflow

## Status

Implemented locally on September 17, 2026.

## Problem

Phase 2 provides bounded, read-only GitHub PR context and registers tools on the Agent, but the end-to-end review path is still implicit. A production-oriented review needs deterministic orchestration: validate the target, retrieve the bounded context, decide whether review is possible, analyze only that context, and return a stable result with observable intermediate steps.

## User Story

As a developer, I want to submit a GitHub owner, repository, pull request number, and optional review focus, then watch a server-side workflow retrieve the PR context and produce a structured review result.

## Scope

In scope:

- Define a typed PR workflow request, output, and NDJSON event contract.
- Implement a Mastra Workflow with explicit validation, GitHub context retrieval, conditional empty-context handling, analysis, and result aggregation.
- Reuse the Phase 2 bounded GitHub service rather than allowing arbitrary Agent tool selection.
- Use deterministic mock analysis when no model key is configured.
- Use the registered Mastra Agent with structured output when model mode is enabled.
- Stream workflow step state to the browser through a server Route Handler.
- Add a focused workflow UI panel, test coverage, interview notes, and verification record.

Out of scope:

- Repository-wide RAG, history retrieval, or codebase indexing.
- Per-user memory, multi-user authorization, write actions, or approval steps.
- Durable workflow persistence and resuming interrupted runs.
- Parallel per-file model reviews. The current bounded PR context is analyzed as one unit.

## Input Contract

```ts
type PullRequestReviewRequest = {
  owner: string;
  repo: string;
  pullNumber: number;
  focus?: string;
};
```

Constraints:

- `owner`, `repo`, and `pullNumber` use the Phase 2 GitHub target constraints.
- `focus` is optional and capped at 500 characters.
- The browser cannot provide a GitHub URL, ref, token, arbitrary path, raw diff, or model prompt.

## Output Contract

```ts
type PullRequestReviewOutput = {
  target: {
    owner: string;
    repo: string;
    pullNumber: number;
  };
  reviewable: boolean;
  context: {
    selectedFileCount: number;
    skippedFileCount: number;
    patchCharacters: number;
  };
  result: ReviewResult;
};
```

`reviewable` is `false` when deterministic selection produced no files. In that case the workflow returns an empty findings array and explains the limitation instead of sending an empty context to a model.

## Behavior

1. The API validates the request body and byte size before opening a stream.
2. The workflow validates the typed request again at its application boundary.
3. The workflow reads bounded PR context through the Phase 2 `GitHubClient`.
4. A conditional branch returns a safe, incomplete result when no selected files exist.
5. Otherwise, mock mode returns a deterministic result; model mode sends only the assembled bounded context to `prReviewAgent` and validates the structured result.
6. The Route Handler maps Mastra workflow step events to stable application NDJSON events.
7. GitHub and model errors are mapped to safe messages. No token, raw upstream body, or untrusted content is logged or returned as an instruction.

## Acceptance Criteria

- A public PR can be submitted from the browser and produces step updates plus a final result.
- The workflow is registered in `Mastra`.
- Mock mode works without `OPENAI_API_KEY`.
- The no-selected-file branch produces a safe, non-hallucinated empty review.
- GitHub context is fetched through the same bounded service as Phase 2.
- Model input labels PR title, body, patches, file content, and focus as untrusted data.
- The client can cancel an in-flight workflow request.
- Tests cover input validation, prompt boundaries, mock output, and the no-selected-file branch.
- `npm run verify` passes.

## Safety Requirements

- The workflow does not create new network capabilities; it reuses the fixed-host, GET-only GitHub client.
- Model calls remain server-side.
- The workflow does not execute GitHub content or allow it to control workflow branches.
- Branching is based only on deterministic selected-file count.
- Every model-bound text field is delimited as untrusted data.

