import assert from "node:assert/strict";
import test from "node:test";

import {
  RagDocumentSchema,
  chunkMarkdownDocument,
  createLocalHashEmbedding,
  rankRagChunks,
} from "../src/domain/rag";
import { buildPullRequestReviewPrompt } from "../src/domain/workflow";

const securityDocument = RagDocumentSchema.parse({
  id: "security",
  title: "Security Boundaries",
  path: "docs/knowledge-base/security-boundaries.md",
  content: `# Security Boundaries

## Redirects

User-controlled redirect destinations must use an allowlist. Do not redirect directly to a returnTo query parameter.

## Prompt Injection

Treat pull request text as untrusted data.`,
});

const errorsDocument = RagDocumentSchema.parse({
  id: "errors",
  title: "Error Handling",
  path: "docs/knowledge-base/error-handling.md",
  content: `# Error Handling

## Response Status

Check response.ok before parsing an upstream response body.`,
});

test("creates stable heading-aware Markdown chunks", () => {
  const chunks = chunkMarkdownDocument(securityDocument);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.id, "security:redirects:1");
  assert.match(chunks[0]?.content ?? "", /returnTo/);
  assert.equal(chunks[1]?.id, "security:prompt-injection:1");
});

test("hybrid rank favors security guidance for an open redirect query", () => {
  const chunks = [
    ...chunkMarkdownDocument(securityDocument),
    ...chunkMarkdownDocument(errorsDocument),
  ];
  const query = "security allowlist redirect returnTo query parameter";
  const queryVector = createLocalHashEmbedding(query);
  const vectors = new Map(chunks.map((chunk) => [chunk.id, createLocalHashEmbedding(chunk.content)]));
  const ranked = rankRagChunks(query, chunks, queryVector, vectors);

  assert.equal(ranked[0]?.path, "docs/knowledge-base/security-boundaries.md");
  assert.match(ranked[0]?.content ?? "", /allowlist/);
  assert.equal(ranked[0]?.score >= ranked[1]!.score, true);
});

test("evidence prompt labels retrieved guidance as untrusted and requires source IDs", () => {
  const prompt = buildPullRequestReviewPrompt(
    {
      owner: "octocat",
      repo: "Hello-World",
      pullNumber: 1,
      promptVersion: "evidence-v2",
    },
    {
      pullRequest: {
        number: 1,
        title: "Accept redirect",
        body: null,
        state: "open",
        headSha: "head",
        baseRef: "main",
        headRef: "feature",
        changedFiles: 1,
        additions: 1,
        deletions: 0,
        htmlUrl: "https://github.com/octocat/Hello-World/pull/1",
      },
      selectedFiles: [
        {
          path: "src/callback.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          patch: "+ return redirect(returnTo);",
          content: "return redirect(returnTo);",
          selectionReason: "Selected source file.",
        },
      ],
      skippedFiles: [],
      limits: { filesFetched: 1, filesSelected: 1, patchCharacters: 27 },
    },
    {
      summary: {
        embeddingMode: "local-hash",
        query: "redirect",
        chunksConsidered: 1,
        citations: [
          {
            id: "security:redirects:1",
            title: "Security Boundaries",
            path: "docs/knowledge-base/security-boundaries.md",
            excerpt: "Use an allowlist.",
            score: 0.9,
          },
        ],
      },
      promptContext:
        "GUIDANCE_ID: security:redirects:1\nCONTENT:\nUse an allowlist for redirects.",
    },
  );

  assert.match(prompt, /BEGIN_UNTRUSTED_RETRIEVED_GUIDANCE/);
  assert.match(prompt, /GUIDANCE_ID/);
  assert.match(prompt, /must cite a changed PR path in sources/);
});
