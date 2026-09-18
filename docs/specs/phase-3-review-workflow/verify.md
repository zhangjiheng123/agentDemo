# Phase 3 Verification

## Automated Checks

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Run all checks with:

```bash
npm run verify
```

## Manual Checks

- Submit a public PR such as `octocat/Hello-World#1` and confirm validation, retrieval, analysis, and aggregation steps appear.
- In default mock mode, confirm the output clearly states that code-quality analysis is deterministic.
- Submit a PR where all changed files are skipped; confirm the result has no fabricated findings.
- Configure a model key and non-mock mode; confirm the Agent receives bounded context and returns a schema-valid result.
- Cancel during retrieval or analysis; confirm the browser leaves the running state and no later step is started.
- Confirm response payloads do not contain `GITHUB_TOKEN`, raw GitHub headers, or unbounded source content.

## Exit Criteria

Phase 3 is complete when a GitHub PR target follows a registered Mastra Workflow with visible steps, deterministic branching, safe cancellation and timeouts, a structured output, updated learning documents, and passing verification.

## Validation Record

- September 17, 2026: `npm run verify` passed outside the managed sandbox: TypeScript, ESLint, twelve unit tests, and the Next.js production build all succeeded.
- September 17, 2026: Manual local workflow API check passed against the existing development server at `http://localhost:3000`. `POST /api/workflows/review` for public `octocat/Hello-World#1` returned HTTP 200 with validation, GitHub context, analysis, aggregation, and final structured-result NDJSON events.
- September 17, 2026: Default Mock mode was used for the manual check. GitHub retrieval was real; only the analysis step was deterministic.

## Known Deferrals

- Parallel per-file review, durable workflow run storage, resume/suspend, and retry backoff telemetry are deferred until a production persistence and observability design is chosen.
- Repository-wide RAG and semantic context selection remain Phase 4.
- User identity, repository authorization, tool approvals, and write actions remain Phase 5.
- The production build emits Mastra telemetry/instrumentation deprecation warnings. They do not block functionality; Phase 6 will replace legacy telemetry setup with AI Tracing and add application-level observability.
