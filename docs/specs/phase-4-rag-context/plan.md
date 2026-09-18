# Phase 4 Plan: Prompt Baseline And RAG Context

## Workflow

```text
validate-review-request
  -> fetch-pr-context
  -> retrieve-review-guidance
  -> conditional branch
     -> create-empty-review
     -> analyze-pr-context
  -> aggregate-review-result
```

The retrieval step belongs to the Workflow because it is deterministic context preparation. The Agent does not decide where to search or how much documentation to retrieve; it receives only the already-bounded result.

## Prompt Versions

| Version | Goal | Use |
| --- | --- | --- |
| `baseline-v1` | Preserve the original focused review instruction. | Establish a comparison baseline. |
| `evidence-v2` | Require evidence-backed findings, discourage style-only noise, and require retrieved IDs when guidance affects a finding. | Default learning and review mode. |

The result returns the selected version, so an evaluation record can associate findings with a prompt policy.

## Retrieval Design

### Sources

The first index is intentionally local and visible:

- Project `README.md`
- `docs/knowledge-base/review-guidelines.md`
- `docs/knowledge-base/error-handling.md`
- `docs/knowledge-base/security-boundaries.md`
- `docs/knowledge-base/historical-reviews.md`

This prevents arbitrary filesystem or network retrieval while giving the learner real documents to edit and re-index.

### Query Construction

An explicit user focus is the highest-signal retrieval intent, so it becomes the complete query when present. Without it, the retriever falls back to default review concerns, PR title, and selected paths. This prevents generic titles or a changed `README` path from overwhelming a targeted security or error-handling query.

### Chunking

Markdown is split by headings first, then into approximately 900-character chunks with 140-character overlap. Each chunk has a stable ID based on path, heading, and index.

### Embeddings

Default `local-hash` mode maps normalized tokens into a deterministic 192-dimensional vector. It is a runnable teaching fallback, not a semantic embedding model.

`openai` mode batches chunk text and the query to `POST /v1/embeddings` using `text-embedding-3-small`. Vectors are cached in memory by model and exact text for the server process. If the request fails, retrieval returns `local-fallback`.

### Hybrid Rank And Rerank

```text
final = 0.55 * lexical + 0.25 * cosine-vector
rerank = final + title/path query-overlap boost + knowledge-base source boost + topic-path metadata boost
```

This is deliberately inspectable. A later production version can replace it with BM25, a persistent vector store, metadata filters, and a model reranker after evaluation data proves the need.

### Context Assembly

At most three chunks and 12,000 characters are included in the model prompt. The browser receives excerpts and scores, not full source documents.

## Failure Policy

| Failure | Behavior |
| --- | --- |
| A source Markdown file is missing | Skip it and continue with remaining fixed sources. |
| Local parsing/chunking fails | Fail the retrieval step safely; the API maps to a generic workflow error. |
| OpenAI embeddings fail | Use local hash retrieval, report `local-fallback`, continue review. |
| GitHub returns no reviewable files | Produce the empty review branch; do not call the Agent. |
| Agent returns invalid output | Preserve Phase 3 strict structured-output failure behavior. |

## Evaluation Assets

- `docs/evals/pr-review-cases.md`: eight fixed cases describing expected true positives and expected non-findings.
- `tests/rag-domain.test.ts`: deterministic chunking, hybrid retrieval, fallback, and prompt assembly tests.
