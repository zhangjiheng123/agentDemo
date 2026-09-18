# Phase 3 Plan: PR Review Workflow

## Data Flow

```text
Browser PR form
  -> POST /api/workflows/review
  -> request byte check + Zod validation
  -> Mastra prReviewWorkflow
     -> validate-review-request
     -> fetch-pr-context (Phase 2 GitHubClient)
     -> conditional branch
        -> create-empty-review
        -> analyze-pr-context (mock or Mastra Agent)
     -> aggregate-review-result
  -> Mastra workflow stream events
  -> application NDJSON events
  -> workflow UI step timeline + structured review card
```

## Module Boundaries

- `src/domain/workflow/`: workflow request, output, event schemas, prompt assembly, and deterministic mock helpers.
- `src/mastra/workflows/pr-review-workflow.ts`: step definitions and explicit orchestration only.
- `app/api/workflows/review/route.ts`: HTTP validation, cancellation, timeout, workflow event translation, and safe errors.
- `app/components/workflow-review-panel.tsx`: input, NDJSON consumption, workflow timeline, cancellation, and output rendering.
- `src/services/github/`: unchanged source of bounded read-only PR context.
- `src/mastra/agents/`: unchanged review capability; called only after workflow has collected bounded context.

## Key Decisions

### Workflow fetches context explicitly

Although Phase 2 registers GitHub tools on the Agent, this first workflow calls the shared GitHub service deterministically. Retrieval order, selection limits, retries, timeouts, and branching are orchestration concerns. The Agent receives one already-bounded context and focuses on interpretation.

### Conditional empty review

The workflow branches on `selectedFiles.length`. A model should not invent review findings when GitHub provides no reviewable patch. The empty path returns a valid `ReviewResult` with no findings and a clear limitation.

### Two execution modes

`REVIEW_MODE=mock` or a missing `OPENAI_API_KEY` selects deterministic analysis, retaining real GitHub retrieval and workflow events. With a model key and non-mock mode, the workflow invokes `prReviewAgent.generate()` with the existing `ReviewResultSchema`.

### Stable application event contract

Mastra event shapes are framework-level details. The Route Handler translates only safe workflow progress into the project NDJSON protocol. This keeps the browser contract stable if Mastra stream internals change.

## Retry And Timeout Boundaries

| Boundary | Policy |
| --- | --- |
| GitHub HTTP request | Phase 2 client: 10 seconds |
| `fetch-pr-context` workflow step | 1 retry for transient service failures |
| Whole workflow request | 45 seconds, abort propagated from browser |
| Agent model call | Shares whole-workflow abort signal |

The current workflow has no persistence or resumption. Those require a durable storage decision and are intentionally deferred.

## Risks And Mitigations

- GitHub can return no reviewable textual patch: branch to an explicit incomplete review.
- Anonymous GitHub access can hit rate limits: preserve Phase 2 safe error mapping and support a server-only read token.
- A model can follow untrusted PR text: delimit all supplied GitHub fields and keep the Agent's no-execution instructions.
- Framework workflow events can change: translate to a small local event schema at the API boundary.
- Browser cancellation cannot guarantee an upstream provider stops immediately: forward abort signals and avoid initiating later steps after cancellation.

