# Phase 2 Tasks

## Design

- [x] Add target, PR metadata, file, context, and error schemas.
- [x] Define deterministic file-selection allowlist, denylist, and size budgets.
- [x] Define GitHub API limits and safe error mapping.

## GitHub Service

- [x] Implement fixed-host authenticated GET helper with timeout.
- [x] Implement PR metadata request.
- [x] Implement bounded changed-file pagination.
- [x] Implement selected file content request at PR head SHA.
- [x] Assemble bounded review context.

## Mastra Tools

- [x] Register `getPullRequest`.
- [x] Register `getPullRequestFiles`.
- [x] Register `getPullRequestContext`.
- [x] Attach tools to `prReviewAgent` with read-only instructions.

## UI And API

- [x] Add `POST /api/github/pr`.
- [x] Add GitHub target form and selected/skipped context preview.
- [x] Make token requirements and public-repository fallback visible without exposing secrets.

## Verification

- [x] Test target validation.
- [x] Test selection policy and budgets.
- [x] Test GitHub error mapping.
- [x] Manually verify one public PR if network access is available.
- [x] Add phase 2 interview documentation.
- [x] Update README and verification record.
- [x] Run `npm run verify`.
