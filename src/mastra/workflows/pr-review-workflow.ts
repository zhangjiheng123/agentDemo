import { createStep, createWorkflow } from "@mastra/core/workflows";

import {
  GitHubServiceError,
  type PullRequestContext,
  type PullRequestTarget,
} from "@/src/domain/github";
import {
  RagWorkflowGuidanceSchema,
  type RagWorkflowGuidance,
} from "@/src/domain/rag";
import {
  PullRequestReviewBranchSchema,
  PullRequestReviewContextEnvelopeSchema,
  PullRequestReviewDecisionSchema,
  PullRequestReviewOutputSchema,
  PullRequestReviewRagEnvelopeSchema,
  PullRequestReviewRequestSchema,
  buildPullRequestReviewPrompt,
  createAgentPullRequestReviewOutput,
  createEmptyPullRequestReview,
  createMockPullRequestReview,
  isReviewMockMode,
  type PullRequestReviewRequest,
} from "@/src/domain/workflow";
import { ReviewResultSchema, type ReviewResult } from "@/src/domain/review";
import { prReviewAgent } from "@/src/mastra/agents/pr-review-agent";
import { createGitHubClient } from "@/src/services/github/client";
import {
  retrieveReviewGuidance,
  type RetrievedReviewGuidance,
} from "@/src/services/rag/retriever";

const GITHUB_CONTEXT_RETRY_DELAY_MS = 250;

type ContextLoader = (
  target: PullRequestTarget,
  signal: AbortSignal,
) => Promise<PullRequestContext>;

type ReviewAnalyzer = (
  request: PullRequestReviewRequest,
  context: PullRequestContext,
  guidance: RagWorkflowGuidance,
  signal: AbortSignal,
) => Promise<ReviewResult>;

export type PullRequestReviewWorkflowDependencies = {
  contextLoader?: ContextLoader;
  guidanceRetriever?: (
    request: PullRequestReviewRequest,
    context: PullRequestContext,
    signal: AbortSignal,
  ) => Promise<RetrievedReviewGuidance>;
  reviewAnalyzer?: ReviewAnalyzer;
};

export function createPullRequestReviewWorkflow(
  dependencies: PullRequestReviewWorkflowDependencies = {},
) {
  const contextLoader = dependencies.contextLoader ?? loadPullRequestContext;
  const guidanceRetriever = dependencies.guidanceRetriever ?? retrieveReviewGuidance;
  const reviewAnalyzer = dependencies.reviewAnalyzer ?? analyzePullRequestContext;

  const validateReviewRequest = createStep({
    id: "validate-review-request",
    description: "Validate the typed GitHub PR target and optional review focus.",
    inputSchema: PullRequestReviewRequestSchema,
    outputSchema: PullRequestReviewRequestSchema,
    execute: async ({ inputData }) => PullRequestReviewRequestSchema.parse(inputData),
  });

  const fetchPrContext = createStep({
    id: "fetch-pr-context",
    description: "Read bounded PR metadata, selected patches, and selected file content.",
    inputSchema: PullRequestReviewRequestSchema,
    outputSchema: PullRequestReviewContextEnvelopeSchema,
    execute: async ({ inputData, abortSignal }) => ({
      request: inputData,
      context: await contextLoader(inputData, abortSignal),
    }),
  });

  const createEmptyReview = createStep({
    id: "create-empty-review",
    description: "Return a safe result when no textual files are available for review.",
    inputSchema: PullRequestReviewRagEnvelopeSchema,
    outputSchema: PullRequestReviewDecisionSchema,
    execute: async ({ inputData }) =>
      createEmptyPullRequestReview(
        inputData.request,
        inputData.context,
        inputData.guidance.summary,
      ),
  });

  const retrieveReviewGuidanceStep = createStep({
    id: "retrieve-review-guidance",
    description:
      "Retrieve bounded repository review guidance using hybrid lexical and vector ranking.",
    inputSchema: PullRequestReviewContextEnvelopeSchema,
    outputSchema: PullRequestReviewRagEnvelopeSchema,
    execute: async ({ inputData, abortSignal }) => ({
      ...inputData,
      guidance: RagWorkflowGuidanceSchema.parse(
        await guidanceRetriever(inputData.request, inputData.context, abortSignal),
      ),
    }),
  });

  const analyzePrContext = createStep({
    id: "analyze-pr-context",
    description: "Analyze the bounded PR context with deterministic mock logic or the review Agent.",
    inputSchema: PullRequestReviewRagEnvelopeSchema,
    outputSchema: PullRequestReviewDecisionSchema,
    execute: async ({ inputData, abortSignal }) => {
      if (isReviewMockMode()) {
        return createMockPullRequestReview(
          inputData.request,
          inputData.context,
          inputData.guidance.summary,
        );
      }

      const result = await reviewAnalyzer(
        inputData.request,
        inputData.context,
        inputData.guidance,
        abortSignal,
      );

      return createAgentPullRequestReviewOutput(
        inputData.request,
        inputData.context,
        inputData.guidance.summary,
        result,
      );
    },
  });

  return createWorkflow({
    id: "pr-review-workflow",
    description:
      "Validate a PR target, fetch bounded GitHub context, branch on reviewability, analyze, and aggregate a structured review.",
    inputSchema: PullRequestReviewRequestSchema,
    outputSchema: PullRequestReviewOutputSchema,
  })
    .then(validateReviewRequest)
    .then(fetchPrContext)
    .then(retrieveReviewGuidanceStep)
    .branch([
      [
        async ({ inputData }) => inputData.context.selectedFiles.length === 0,
        createEmptyReview,
      ],
      [
        async ({ inputData }) => inputData.context.selectedFiles.length > 0,
        analyzePrContext,
      ],
    ])
    .map(
      async ({ inputData }) => {
        const branchResult = PullRequestReviewBranchSchema.parse(inputData);
        const result =
          branchResult["create-empty-review"] ??
          branchResult["analyze-pr-context"];

        if (!result) {
          throw new Error("The review workflow completed without a branch result.");
        }

        return PullRequestReviewOutputSchema.parse(result);
      },
      { id: "aggregate-review-result" },
    )
    .commit();
}

async function loadPullRequestContext(target: PullRequestTarget, signal: AbortSignal) {
  try {
    return await createGitHubClient().getPullRequestContext(target, signal);
  } catch (error) {
    if (!(error instanceof GitHubServiceError) || error.code !== "upstream_error") {
      throw error;
    }

    await waitForRetry(signal);
    return createGitHubClient().getPullRequestContext(target, signal);
  }
}

async function analyzePullRequestContext(
  request: PullRequestReviewRequest,
  context: PullRequestContext,
  guidance: RagWorkflowGuidance,
  signal: AbortSignal,
) {
  const response = await prReviewAgent.generate(
    buildPullRequestReviewPrompt(request, context, guidance),
    {
    abortSignal: signal,
    maxSteps: 1,
    structuredOutput: {
      schema: ReviewResultSchema,
      errorStrategy: "strict",
      instructions:
        "Return the review result using the provided schema. Every evidence field must identify only supplied patch or file-content evidence. Sources must contain only supplied PR paths or GUIDANCE_ID values.",
    },
    },
  );

  return ReviewResultSchema.parse(response.object);
}

function waitForRetry(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, GITHUB_CONTEXT_RETRY_DELAY_MS);

    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new DOMException("The workflow was cancelled.", "AbortError"));
      },
      { once: true },
    );
  });
}

export const prReviewWorkflow = createPullRequestReviewWorkflow();
