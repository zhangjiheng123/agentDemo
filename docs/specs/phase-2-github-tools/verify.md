# Phase 2 Verification

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

- Submit a public `owner`, `repo`, and `pullNumber`; confirm metadata and selected files render.
- Submit a target with `/`, spaces, or zero pull number; confirm the route rejects it before network access.
- Confirm `GITHUB_TOKEN` is not visible in response payloads or client code.
- Confirm lock, generated, binary, and over-budget files appear in skipped files with a reason.
- Configure a read-only token for a private repository and confirm only server-side access is required.

## Exit Criteria

Phase 2 is complete when tools are registered, route and UI use the same bounded service, tests cover the policy boundaries, and `npm run verify` passes.

## Validation Record

- September 16, 2026: TypeScript type check and ESLint passed.
- September 16, 2026: GitHub unit tests cover unsafe target rejection, file selection, safe status mapping, and content reads pinned to the PR head SHA.
- September 16, 2026: Manual public API check passed without `GITHUB_TOKEN`: `octocat/Hello-World#1` returned HTTP 200, one selected file (`README`), and no skipped files.
- September 16, 2026: `npm run verify` passed outside the managed sandbox: TypeScript, ESLint, eight unit tests, and the Next.js production build all succeeded.

## Known Deferrals

- Private repository access is implemented but not manually verified because no private read-only token was supplied.
- The tools are registered with the Agent; model-driven tool selection is deferred until the review flow is orchestrated in phase 3.
- Full diff chunking, repository-wide context, RAG, and write-action approval remain later-phase work.
