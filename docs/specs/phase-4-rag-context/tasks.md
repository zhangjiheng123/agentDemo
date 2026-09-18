# Phase 4 Tasks

## Design

- [x] Define prompt-version, RAG citation, retrieval summary, and output schemas.
- [x] Define fixed local source boundaries and RAG character budgets.
- [x] Document embedding fallback, hybrid rank, rerank, and failure behavior.

## Knowledge And Retrieval

- [x] Add local Markdown knowledge-base sources.
- [x] Implement heading-aware chunking with stable IDs and overlap.
- [x] Implement local hash-vector and optional OpenAI embedding providers.
- [x] Implement lexical/vector hybrid ranking and deterministic reranking.
- [x] Assemble bounded retrieved context and citations.

## Workflow And UI

- [x] Add `retrieve-review-guidance` before the review branch.
- [x] Add prompt version to request, output, prompt assembly, and UI.
- [x] Show retrieval mode and citations in the workflow result.
- [x] Preserve the no-reviewable-file branch and server-only secrets.

## Evaluation And Verification

- [x] Add fixed PR review evaluation cases.
- [x] Add deterministic RAG and prompt tests.
- [x] Update Phase 4 interview documentation and README.
- [x] Run `npm run verify`.
