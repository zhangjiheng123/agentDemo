# Phase 1 Tasks

## Preparation

- [x] Confirm the installed Mastra stream API and compatible model/provider configuration.
- [x] Add the review request and result Zod schemas.
- [x] Add a prompt builder that marks diff content as untrusted.
- [x] Define mock mode and its deterministic sample result.

## Server

- [x] Add `POST /api/review`.
- [x] Validate JSON body and request size.
- [x] Add model call timeout and safe error mapping.
- [x] Implement NDJSON streaming response.
- [x] Define the final structured result parsing path.

## Client

- [x] Add diff input and review focus input.
- [x] Add submit, cancel, loading, streaming, success, and error states.
- [x] Render summary and findings from the structured result.
- [x] Make mock mode visible during local development.

## Verification

- [x] Add schema tests for valid, missing, and oversized input.
- [x] Add prompt tests that verify untrusted delimiters.
- [x] Add mock stream event tests.
- [x] Run `npm run verify`.
- [x] Update `docs/interview/phase-1-basic-agent.md`.
- [x] Update the root README phase table.
