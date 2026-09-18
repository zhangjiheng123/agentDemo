# Phase 4 Verification

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

- Run a public PR in default mode and confirm `retrieve-review-guidance` appears before analysis.
- Confirm result citations display a knowledge-base path, excerpt, and score.
- Change prompt version between `baseline-v1` and `evidence-v2`; confirm the selected version is returned in the result.
- Set `RAG_EMBEDDING_MODE=openai` with a valid server-side key and confirm result mode is `openai`.
- Temporarily use an invalid embedding configuration and confirm the review continues in `local-fallback` mode.
- Confirm no retrieved full text, API key, or GitHub token is sent to the browser.

## Validation Record

- September 17, 2026: `npm run verify` passed outside the managed sandbox: TypeScript, ESLint, fifteen unit tests, and the Next.js production build all succeeded.
- September 17, 2026: Manual local workflow API check passed through the existing development server at `http://localhost:3000`. A public `octocat/Hello-World#1` request with `focus: "security redirect handling"` emitted the `retrieve-review-guidance` progress events and returned citation metadata in its final NDJSON result.
- September 17, 2026: The manual run used default `local-hash` embedding mode and `evidence-v2`. After hybrid ranking and topic-path reranking, the top three citations were from `docs/knowledge-base/security-boundaries.md`.
- September 17, 2026: Production build confirmed the fixed knowledge-source reads do not trigger Turbopack's whole-project filesystem tracing warning.

## Known Deferrals

- No persistent vector database or background indexing is used.
- The local hash vector is for deterministic learning and fallback, not semantic-quality production retrieval.
- Prompt-result quality scoring against live models remains a Phase 6 responsibility.
- The production build emits Mastra telemetry/instrumentation deprecation warnings. They do not block this phase; Phase 6 will adopt supported AI Tracing and add retrieval/model metrics.
