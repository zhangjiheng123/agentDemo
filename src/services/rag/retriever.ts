import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  RagDocumentSchema,
  RagGuidanceSummarySchema,
  assembleGuidancePromptContext,
  buildReviewRetrievalQuery,
  chunkMarkdownDocument,
  createLocalHashEmbedding,
  rankRagChunks,
  toRagCitation,
  type RagChunk,
  type RagEmbeddingMode,
  type RagWorkflowGuidance,
} from "@/src/domain/rag";
import type { PullRequestContext } from "@/src/domain/github";
import type { PullRequestReviewRequest } from "@/src/domain/workflow";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const OPENAI_EMBEDDING_TIMEOUT_MS = 10_000;
const embeddingCache = new Map<string, number[]>();

export type RetrievedReviewGuidance = RagWorkflowGuidance;

export async function retrieveReviewGuidance(
  request: PullRequestReviewRequest,
  context: PullRequestContext,
  signal: AbortSignal,
): Promise<RetrievedReviewGuidance> {
  const query = buildReviewRetrievalQuery(request, context);
  const chunks = (await loadKnowledgeDocuments()).flatMap(chunkMarkdownDocument);
  const { mode, queryVector, chunkVectors } = await createEmbeddingSet(query, chunks, signal);
  const rankedChunks = rankRagChunks(query, chunks, queryVector, chunkVectors).slice(0, 3);

  return {
    summary: RagGuidanceSummarySchema.parse({
      embeddingMode: mode,
      query,
      chunksConsidered: chunks.length,
      citations: rankedChunks.map(toRagCitation),
    }),
    promptContext: assembleGuidancePromptContext(rankedChunks),
  };
}

async function loadKnowledgeDocuments() {
  const documents = await Promise.all([
    loadKnownKnowledgeSource("README.md", readFile(path.join(process.cwd(), "README.md"), "utf8")),
    loadKnownKnowledgeSource(
      "docs/knowledge-base/review-guidelines.md",
      readFile(
        path.join(process.cwd(), "docs", "knowledge-base", "review-guidelines.md"),
        "utf8",
      ),
    ),
    loadKnownKnowledgeSource(
      "docs/knowledge-base/error-handling.md",
      readFile(
        path.join(process.cwd(), "docs", "knowledge-base", "error-handling.md"),
        "utf8",
      ),
    ),
    loadKnownKnowledgeSource(
      "docs/knowledge-base/security-boundaries.md",
      readFile(
        path.join(process.cwd(), "docs", "knowledge-base", "security-boundaries.md"),
        "utf8",
      ),
    ),
    loadKnownKnowledgeSource(
      "docs/knowledge-base/historical-reviews.md",
      readFile(
        path.join(process.cwd(), "docs", "knowledge-base", "historical-reviews.md"),
        "utf8",
      ),
    ),
  ]);

  return documents.filter((document): document is NonNullable<typeof document> => document !== null);
}

async function loadKnownKnowledgeSource(relativePath: string, contentPromise: Promise<string>) {
  try {
    const content = await contentPromise;

    return RagDocumentSchema.parse({
      id: relativePath.replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, ""),
      title: getDocumentTitle(content, relativePath),
      path: relativePath,
      content,
    });
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

async function createEmbeddingSet(query: string, chunks: RagChunk[], signal: AbortSignal) {
  if (process.env.RAG_EMBEDDING_MODE === "openai" && process.env.OPENAI_API_KEY) {
    try {
      const vectors = await getOpenAiEmbeddings(
        [query, ...chunks.map((chunk) => chunk.content)],
        signal,
      );

      return {
        mode: "openai" as const,
        queryVector: vectors[0]!,
        chunkVectors: new Map(chunks.map((chunk, index) => [chunk.id, vectors[index + 1]!])),
      };
    } catch (error) {
      console.warn("RAG embedding request failed; falling back to local hash vectors.", error);

      return createLocalEmbeddingSet(query, chunks, "local-fallback");
    }
  }

  return createLocalEmbeddingSet(query, chunks, "local-hash");
}

function createLocalEmbeddingSet(
  query: string,
  chunks: RagChunk[],
  mode: Extract<RagEmbeddingMode, "local-hash" | "local-fallback">,
) {
  return {
    mode,
    queryVector: createLocalHashEmbedding(query),
    chunkVectors: new Map(chunks.map((chunk) => [chunk.id, createLocalHashEmbedding(chunk.content)])),
  };
}

async function getOpenAiEmbeddings(values: string[], signal: AbortSignal) {
  const model = (process.env.RAG_EMBEDDING_MODEL ?? "openai/text-embedding-3-small").replace(
    /^openai\//,
    "",
  );
  const vectors: Array<number[] | undefined> = Array.from({ length: values.length });
  const missingValues: string[] = [];
  const missingIndexes: number[] = [];

  values.forEach((value, index) => {
    const key = `${model}:${value}`;
    const cached = embeddingCache.get(key);

    if (cached) {
      vectors[index] = cached;
    } else {
      missingIndexes.push(index);
      missingValues.push(value);
    }
  });

  if (missingValues.length > 0) {
    const response = await postEmbeddingRequest(model, missingValues, signal);

    response.forEach((vector, index) => {
      const valueIndex = missingIndexes[index]!;
      const key = `${model}:${values[valueIndex]!}`;

      embeddingCache.set(key, vector);
      vectors[valueIndex] = vector;
    });
  }

  if (vectors.some((vector) => !vector)) {
    throw new Error("OpenAI embeddings response did not include every requested vector.");
  }

  return vectors as number[][];
}

async function postEmbeddingRequest(model: string, input: string[], signal: AbortSignal) {
  const timeout = new AbortController();
  const timeoutId = setTimeout(() => timeout.abort(), OPENAI_EMBEDDING_TIMEOUT_MS);
  const abortRequest = () => timeout.abort();

  if (signal.aborted) {
    timeout.abort();
  } else {
    signal.addEventListener("abort", abortRequest, { once: true });
  }

  try {
    const response = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input }),
      signal: timeout.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI embeddings request failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>;
    };
    const data = payload.data ?? [];

    if (data.length !== input.length) {
      throw new Error("OpenAI embeddings response length did not match the request.");
    }

    return data
      .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
      .map((item) => {
        if (!Array.isArray(item.embedding) || item.embedding.length === 0) {
          throw new Error("OpenAI embeddings response contained an invalid vector.");
        }

        return item.embedding;
      });
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener("abort", abortRequest);
  }
}

function getDocumentTitle(content: string, fallbackPath: string) {
  const heading = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();

  return heading || fallbackPath;
}

function isMissingFileError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT",
  );
}
