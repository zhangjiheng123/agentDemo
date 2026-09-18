# Phase 1 Verification

## Automated Checks

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

The combined command is:

```bash
npm run verify
```

## Manual Checks

- Open the home page and submit the built-in sample diff in mock mode.
- Confirm the UI visibly transitions through submitting and streaming states.
- Confirm a valid result renders summary and severity-tagged findings.
- Submit an empty diff and confirm a client-visible validation error.
- Submit an oversized diff and confirm the server rejects it.
- Stop or omit the model provider and confirm the UI shows a safe error.
- Inspect browser-exposed environment values and confirm no secret is present.

## Validation Record

- September 16, 2026: TypeScript type check passed.
- September 16, 2026: ESLint passed.
- September 16, 2026: Four unit tests passed: valid input, invalid/oversized diff, untrusted prompt delimiters, and mock stream events.
- September 16, 2026: `npm run verify` passed outside the managed sandbox. The managed sandbox blocks Node child processes with `spawn EPERM`, so production builds and Node test runner validation require the normal local execution environment.
- September 16, 2026: Manual mock API verification passed. A valid request returned `meta -> progress -> text -> progress -> text -> result`; an empty diff returned HTTP 400 before stream creation.

## Known Deferrals

- The real provider path is type-checked but cannot be functionally exercised without a user-supplied `OPENAI_API_KEY`.
- The raw text stream is display-only. The final review UI is driven solely by the Zod-validated `result` event.
- GitHub retrieval, repository context, Memory, RAG, MCP, and workflow orchestration remain intentionally deferred to later phases.

## Exit Criteria

Phase 1 is complete only when all acceptance criteria in `spec.md` pass and the known risks have either been mitigated or explicitly deferred to a later phase.
