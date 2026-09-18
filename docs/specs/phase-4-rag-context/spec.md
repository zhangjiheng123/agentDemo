# Phase 4 Specification: Prompt Baseline And RAG Context

## Status

Implemented locally on September 17, 2026.

## Problem

The Phase 3 workflow only provides a bounded PR diff and file content. That is often insufficient for code review: a change can look reasonable until it conflicts with repository error-handling rules, security boundaries, or a pattern from a prior review. The project also needs a repeatable way to compare prompt behavior instead of treating prompt edits as intuition.

## User Story

As a developer learning LLM application engineering, I want to select a prompt version, retrieve relevant repository guidance for a PR review, inspect the retrieved citations, and verify that the Agent only uses evidence supplied by the PR or retrieved guidance.

## Scope

In scope:

- Add two versioned PR review prompt policies: `baseline-v1` and `evidence-v2`.
- Add a small repository knowledge base with review guidelines, error-handling rules, security boundaries, and historical review examples.
- Parse Markdown, split it into bounded overlapping chunks, and attach deterministic source IDs.
- Retrieve relevant chunks using hybrid lexical plus vector similarity, then apply a transparent deterministic rerank.
- Use a local hash-vector embedding by default so the project is runnable without a model key.
- Optionally call OpenAI's embeddings endpoint when explicitly configured server-side.
- Add a retrieval step to the existing Mastra Workflow before analysis.
- Assemble bounded retrieved context into the Agent prompt and return citations to the UI.
- Add deterministic retrieval and prompt tests plus a fixed evaluation-case document.

Out of scope:

- Repository cloning, arbitrary remote documentation traversal, or reviewing arbitrary files outside the selected PR.
- Persistent vector databases, multi-tenant indexes, background ingestion queues, or online relevance-learning.
- Model-based reranking. The first version uses a transparent deterministic reranker.
- Automatic quality scoring of live model responses. The fixed cases prepare Phase 6 evaluation.

## Input Contract

```ts
type PullRequestReviewRequest = {
  owner: string;
  repo: string;
  pullNumber: number;
  focus?: string;
  promptVersion?: "baseline-v1" | "evidence-v2";
};
```

`evidence-v2` is the default. It requires findings to identify supplied PR evidence and instructs the model to cite retrieved guidance IDs only when it actually affects the conclusion.

## RAG Data Flow

```text
docs/knowledge-base/*.md + README.md
  -> Markdown parsing
  -> heading-aware, overlapping character chunks
  -> embeddings
     -> local hash vector by default
     -> OpenAI embeddings only when configured
  -> lexical score + cosine vector score
  -> weighted fusion
  -> deterministic rerank
  -> top 3 chunks and citation summary
  -> bounded prompt context
  -> Agent structured review result
```

## Output Contract

The Phase 3 output gains:

```ts
{
  promptVersion: "baseline-v1" | "evidence-v2";
  guidance: {
    embeddingMode: "local-hash" | "openai" | "local-fallback";
    query: string;
    chunksConsidered: number;
    citations: Array<{
      id: string;
      title: string;
      path: string;
      excerpt: string;
      score: number;
    }>;
  };
}
```

Each review finding may also include `sources`, containing PR paths and retrieved guidance IDs.

## Behavior

1. The workflow validates the PR target, review focus, and selected prompt version.
2. It loads bounded PR context through the existing fixed-host GitHub client.
3. When a user supplies review focus, it uses that focus as the retrieval query; otherwise it builds a fallback query from review defaults, PR title, and selected file paths.
4. It parses the local knowledge-base Markdown documents and chunks them at a bounded size with overlap.
5. It ranks chunks by lexical overlap and cosine similarity. A deterministic reranker favors query overlap in document titles and paths.
6. In `RAG_EMBEDDING_MODE=openai`, the server requests embeddings using `OPENAI_API_KEY`; on embedding failure it safely falls back to local hash vectors and reports `local-fallback`.
7. The workflow returns an empty review when no PR file is reviewable; it does not invoke the Agent.
8. For a reviewable PR, the Agent receives only bounded PR context plus bounded retrieved chunks, all marked as untrusted data.
9. The API streams the retrieval step state and returns citation metadata to the browser.

## Safety Requirements

- Knowledge-base documents, PR text, diff, file content, and user focus are all prompt data, never executable instructions.
- No knowledge source is fetched from a caller-provided URL or path.
- `OPENAI_API_KEY` is read only on the server. It is never included in RAG output, logs, or client code.
- The RAG context has a maximum number of chunks and character budget before model invocation.
- Failed optional embeddings degrade to local retrieval rather than disabling PR review.
- Retrieved documentation is advisory evidence; it cannot authorize tools, write GitHub data, or change workflow branches.

## Acceptance Criteria

- The workflow has an observable `retrieve-review-guidance` step.
- Default local mode works with no model key and returns citations.
- Hybrid ranking retrieves the security guidance for a security-oriented query in deterministic tests.
- Prompt tests assert untrusted delimiters and the `evidence-v2` citation rule.
- The UI displays prompt version, retrieval mode, and citations.
- A fixed evaluation-case document has at least eight PR review scenarios.
- `npm run verify` passes.
