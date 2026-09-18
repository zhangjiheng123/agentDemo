import { z } from "zod";

import type { PullRequestContext } from "@/src/domain/github";

export const RAG_CHUNK_SIZE = 900;
export const RAG_CHUNK_OVERLAP = 140;
export const RAG_MAX_RETRIEVED_CHUNKS = 3;
export const RAG_MAX_CONTEXT_CHARACTERS = 12_000;
export const LOCAL_HASH_VECTOR_DIMENSIONS = 192;

export const RagEmbeddingModeSchema = z.enum([
  "local-hash",
  "openai",
  "local-fallback",
]);

export const RagDocumentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  path: z.string().min(1),
  content: z.string().min(1),
});

export const RagChunkSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  title: z.string().min(1),
  path: z.string().min(1),
  heading: z.string().min(1),
  content: z.string().min(1),
});

export const RagCitationSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  path: z.string().min(1),
  excerpt: z.string().min(1).max(320),
  score: z.number().min(0).max(1),
});

export const RagGuidanceSummarySchema = z.object({
  embeddingMode: RagEmbeddingModeSchema,
  query: z.string().min(1).max(1_200),
  chunksConsidered: z.number().int().nonnegative(),
  citations: z.array(RagCitationSchema).max(RAG_MAX_RETRIEVED_CHUNKS),
});

export const RagWorkflowGuidanceSchema = z.object({
  summary: RagGuidanceSummarySchema,
  promptContext: z.string().max(RAG_MAX_CONTEXT_CHARACTERS),
});

export type RagDocument = z.infer<typeof RagDocumentSchema>;
export type RagChunk = z.infer<typeof RagChunkSchema>;
export type RagCitation = z.infer<typeof RagCitationSchema>;
export type RagGuidanceSummary = z.infer<typeof RagGuidanceSummarySchema>;
export type RagEmbeddingMode = z.infer<typeof RagEmbeddingModeSchema>;
export type RagWorkflowGuidance = z.infer<typeof RagWorkflowGuidanceSchema>;

export type RankedRagChunk = RagChunk & {
  lexicalScore: number;
  vectorScore: number;
  score: number;
};

export function buildReviewRetrievalQuery(
  request: { focus?: string },
  context: PullRequestContext,
) {
  const focus = request.focus?.trim();

  if (focus) {
    return focus.replace(/\s+/g, " ").slice(0, 1_200);
  }

  const selectedPaths = context.selectedFiles.map((file) => file.path).join(" ");

  return [
    "correctness reliability security maintainability",
    context.pullRequest.title,
    selectedPaths,
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_200);
}

export function chunkMarkdownDocument(document: RagDocument): RagChunk[] {
  const sections = splitMarkdownSections(document.content);
  const chunks: RagChunk[] = [];

  for (const section of sections) {
    const content = `${section.heading}\n${section.content}`.trim();

    for (const [index, part] of splitWithOverlap(content).entries()) {
      chunks.push(
        RagChunkSchema.parse({
          id: `${document.id}:${slugify(section.heading)}:${index + 1}`,
          documentId: document.id,
          title: document.title,
          path: document.path,
          heading: section.heading,
          content: part,
        }),
      );
    }
  }

  return chunks;
}

export function createLocalHashEmbedding(value: string) {
  const vector = Array.from<number>({ length: LOCAL_HASH_VECTOR_DIMENSIONS }).fill(0);

  for (const token of tokenize(value)) {
    const hash = hashToken(token);
    const index = Math.abs(hash) % LOCAL_HASH_VECTOR_DIMENSIONS;
    vector[index] += hash % 2 === 0 ? 1 : -1;
  }

  return normalizeVector(vector);
}

export function rankRagChunks(
  query: string,
  chunks: RagChunk[],
  queryVector: number[],
  chunkVectors: Map<string, number[]>,
) {
  const queryTokens = new Set(tokenize(query));

  return chunks
    .map((chunk) => {
      const chunkTokens = new Set(tokenize(chunk.content));
      const titleTokens = new Set(tokenize(`${chunk.title} ${chunk.path} ${chunk.heading}`));
      const lexicalScore = overlapScore(queryTokens, chunkTokens);
      const vectorScore = normalizeCosine(cosineSimilarity(queryVector, chunkVectors.get(chunk.id) ?? []));
      const titlePathBoost = overlapScore(queryTokens, titleTokens) * 0.2;
      const guidanceSourceBoost = chunk.path.startsWith("docs/knowledge-base/") ? 0.12 : 0;
      const topicBoost = getTopicBoost(queryTokens, chunk.path);
      const score = Math.min(
        1,
        0.55 * lexicalScore +
          0.25 * vectorScore +
          titlePathBoost +
          guidanceSourceBoost +
          topicBoost,
      );

      return {
        ...chunk,
        lexicalScore,
        vectorScore,
        score,
      };
    })
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

export function toRagCitation(chunk: RankedRagChunk): RagCitation {
  return RagCitationSchema.parse({
    id: chunk.id,
    title: chunk.title,
    path: chunk.path,
    excerpt: toExcerpt(chunk.content),
    score: Number(chunk.score.toFixed(3)),
  });
}

export function assembleGuidancePromptContext(chunks: RankedRagChunk[]) {
  const sections: string[] = [];
  let remaining = RAG_MAX_CONTEXT_CHARACTERS;

  for (const chunk of chunks.slice(0, RAG_MAX_RETRIEVED_CHUNKS)) {
    if (remaining <= 0) {
      break;
    }

    const section = [
      `GUIDANCE_ID: ${chunk.id}`,
      `SOURCE: ${chunk.path}`,
      `TITLE: ${chunk.title}`,
      `HEADING: ${chunk.heading}`,
      "CONTENT:",
      chunk.content,
    ].join("\n");
    const bounded = truncate(section, remaining);

    sections.push(bounded);
    remaining -= bounded.length;
  }

  return sections.join("\n\n");
}

function splitMarkdownSections(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const sections: Array<{ heading: string; content: string }> = [];
  let heading = "Document";
  let current: string[] = [];

  function pushSection() {
    const sectionContent = current.join("\n").trim();

    if (sectionContent) {
      sections.push({ heading, content: sectionContent });
    }
  }

  for (const line of lines) {
    const match = /^(#{1,3})\s+(.+?)\s*$/.exec(line);

    if (match) {
      pushSection();
      heading = match[2]!;
      current = [];
    } else {
      current.push(line);
    }
  }

  pushSection();

  return sections.length > 0 ? sections : [{ heading: "Document", content }];
}

function splitWithOverlap(value: string) {
  if (value.length <= RAG_CHUNK_SIZE) {
    return [value];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < value.length) {
    let end = Math.min(value.length, start + RAG_CHUNK_SIZE);

    if (end < value.length) {
      const lastBreak = value.lastIndexOf("\n", end);

      if (lastBreak > start + Math.floor(RAG_CHUNK_SIZE * 0.55)) {
        end = lastBreak;
      }
    }

    chunks.push(value.slice(start, end).trim());

    if (end >= value.length) {
      break;
    }

    start = Math.max(start + 1, end - RAG_CHUNK_OVERLAP);
  }

  return chunks.filter(Boolean);
}

function tokenize(value: string) {
  const normalized = value.toLocaleLowerCase();
  const wordTokens = normalized.match(/[\p{L}\p{N}_/-]{2,}/gu) ?? [];
  const cjkRuns = normalized.match(/[\u3400-\u9fff]+/g) ?? [];
  const cjkTokens = cjkRuns.flatMap((run) => {
    const characters = Array.from(run);
    const bigrams = characters.slice(0, -1).map((character, index) => `${character}${characters[index + 1]}`);

    return [...characters, ...bigrams];
  });

  return [...wordTokens, ...cjkTokens];
}

function overlapScore(queryTokens: Set<string>, candidateTokens: Set<string>) {
  if (queryTokens.size === 0 || candidateTokens.size === 0) {
    return 0;
  }

  let shared = 0;

  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      shared += 1;
    }
  }

  return shared / Math.sqrt(queryTokens.size * candidateTokens.size);
}

function hashToken(value: string) {
  let hash = 2166136261;

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return hash | 0;
}

function normalizeVector(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));

  return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }

  return left.reduce((total, value, index) => total + value * (right[index] ?? 0), 0);
}

function normalizeCosine(value: number) {
  return Math.max(0, Math.min(1, (value + 1) / 2));
}

function toExcerpt(value: string) {
  return truncate(value.replace(/\s+/g, " ").trim(), 320);
}

function getTopicBoost(queryTokens: Set<string>, path: string) {
  const topicMatches = [
    ["security", "security-boundaries"],
    ["安全", "security-boundaries"],
    ["error", "error-handling"],
    ["错误", "error-handling"],
    ["timeout", "error-handling"],
    ["取消", "error-handling"],
    ["review", "review-guidelines"],
    ["审查", "review-guidelines"],
    ["history", "historical-reviews"],
    ["历史", "historical-reviews"],
  ];

  return topicMatches.some(
    ([queryToken, pathToken]) => queryTokens.has(queryToken) && path.includes(pathToken),
  )
    ? 0.14
    : 0;
}

function truncate(value: string, limit: number) {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, Math.max(0, limit - 26))} [TRUNCATED]`;
}

function slugify(value: string) {
  const slug = value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return slug || "section";
}
