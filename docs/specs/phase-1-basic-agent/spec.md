# Phase 1 Specification: Basic PR Review Agent

## Status

Implemented locally on September 16, 2026. Real-model behavior requires `OPENAI_API_KEY`; mock mode remains the default verification path.

## Problem

The phase 0 project can register a Mastra Agent, but a user cannot submit a small review request or see a useful result. We need one narrow vertical slice that proves the Agent can receive review context, stream a response, and return a predictable review shape.

## User Story

As a developer, I want to paste a small code diff and review instructions into the web page, so that I can receive an evidence-based review response without connecting GitHub yet.

## Scope

In scope:

- A server-side API endpoint for a review request.
- Input validation for a small diff and optional review focus.
- Streaming text response to the browser.
- A structured review result containing summary and findings.
- A minimal UI for entering a diff and displaying status and output.
- A deterministic mock mode for local verification without an API key.

Out of scope:

- GitHub API access.
- Repository checkout or arbitrary file reads.
- Memory, RAG, MCP, human approval, or multi-step Workflow.
- Automatic code modification.
- Authentication and multi-user persistence.

## Input Contract

```ts
type ReviewRequest = {
  diff: string;
  focus?: string;
};
```

Constraints:

- `diff` is required and must be between 1 and 20,000 characters.
- `focus` is optional and must be at most 500 characters.
- The server must reject malformed JSON and invalid fields with a 4xx response.

## Output Contract

The final review result should contain:

```ts
type ReviewResult = {
  summary: string;
  findings: Array<{
    severity: "critical" | "high" | "medium" | "low" | "info";
    title: string;
    explanation: string;
    evidence: string;
    suggestion?: string;
  }>;
};
```

The streamed transport may expose text chunks while the final response is being assembled. The UI must make it clear that streamed text is not yet a finalized structured result.

## Behavior

1. The browser submits a diff and optional focus to the server.
2. The server validates and normalizes the input.
3. The server builds a review prompt with explicit untrusted-content boundaries.
4. The server invokes the Mastra Agent.
5. The browser renders chunks as they arrive.
6. The server returns or emits a final structured result.
7. Errors are shown as actionable user-facing messages without exposing provider or token details.

## Acceptance Criteria

- A user can submit a valid sample diff from the UI.
- The request does not expose model or GitHub secrets to the browser.
- Invalid or oversized input is rejected before a model call.
- The browser shows loading, streaming, success, and error states.
- The final result can be rendered without parsing ad hoc headings.
- Mock mode can verify the UI and transport without an API key.
- `npm run verify` passes.

## Safety Requirements

- Treat the diff and focus as untrusted data, not instructions.
- Do not execute submitted code.
- Do not allow the request to select an arbitrary model or URL.
- Do not log the full diff by default.
- Apply a request size limit and a reasonable timeout.
