# Phase 2 Plan: Read-Only GitHub PR Tools

## Data Flow

```text
GitHub target form
  -> POST /api/github/pr
  -> target schema validation
  -> GitHub client (fixed API host, GET only)
  -> PR metadata + paginated changed files
  -> deterministic file selector
  -> selected content reads at head SHA
  -> JSON context preview

Mastra Agent
  -> getPullRequest / getPullRequestFiles / getPullRequestContext tools
  -> same GitHub client and selector
```

## Module Boundaries

- `src/domain/github/`: target schemas, normalized GitHub data, file selection policy, and application error type.
- `src/services/github/`: fixed-host GitHub REST client and context assembly.
- `src/mastra/tools/`: `createTool` registrations; tools call the service layer and do not contain fetch logic.
- `app/api/github/pr/route.ts`: HTTP parsing and safe JSON error mapping.
- `app/components/`: target form and context preview.

## Key Decisions

### Use native fetch, not a broad GitHub SDK

Only four read endpoints are needed. Native fetch keeps the dependency surface and authentication behavior visible for learning. A mature SDK becomes more attractive if later phases add webhooks, mutations, retries across many endpoints, or GraphQL.

### Share one service between route and tools

The preview route should not implement a separate interpretation of GitHub data. Both the deterministic UI preview and Agent tools call the same client and file-selection policy, which prevents review context from diverging.

### Apply deterministic selection before model invocation

The selector has a maximum file count, patch character budget, content budget, extension allowlist, and path denylist. This is a safety, cost, and relevance boundary, not an LLM decision.

### Fetch content at the PR head SHA only

The client obtains `head.sha` from PR metadata, then uses it as the fixed ref when reading selected files. The caller cannot inject an arbitrary ref and cause the review to drift from the PR.

## Initial Limits

| Boundary | Limit |
| --- | ---: |
| Changed file records fetched | 100 |
| Files selected for review | 12 |
| Patch characters sent to context | 60,000 |
| Content characters per selected file | 12,000 |
| Content-bearing files | 8 |
| GitHub request timeout | 10 seconds |

## Risks

- GitHub can omit `patch` for binary or very large changes.
- Public unauthenticated requests are rate limited.
- A private-token configuration can accidentally have more permission than needed.
- Even selected source code can include prompt injection text.

## Mitigations

- Preserve `patch: null` and skip missing-patch files with an explicit reason.
- Return a retry-friendly rate-limit error without exposing response headers.
- Document a fine-grained token with read-only Pull requests and Contents permissions.
- Treat all GitHub text as untrusted data; no tool performs mutation or executes content.
