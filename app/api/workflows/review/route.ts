import { GitHubServiceError } from "@/src/domain/github";
import {
  PullRequestReviewOutputSchema,
  type PullRequestReviewStreamEvent,
  getPullRequestReviewValidationMessage,
  isReviewMockMode,
} from "@/src/domain/workflow";
import { prReviewWorkflow } from "@/src/mastra/workflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 2 * 1024;
const WORKFLOW_TIMEOUT_MS = 45_000;
const encoder = new TextEncoder();

const stepMessages: Record<string, string> = {
  "validate-review-request": "正在验证 GitHub PR 目标与审查关注点。",
  "fetch-pr-context": "正在读取并筛选受限的 GitHub PR 上下文。",
  "retrieve-review-guidance": "正在检索并重排相关的仓库审查规则。",
  "create-empty-review": "没有可审查文本文件，正在生成安全的空结果。",
  "analyze-pr-context": "正在分析已筛选的 PR 上下文。",
  "aggregate-review-result": "正在汇总并验证结构化审查结果。",
};

function jsonError(message: string, status: number) {
  return Response.json(
    { error: { message } },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function writeEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: PullRequestReviewStreamEvent,
) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

function getSafeErrorMessage(error: unknown, cancelled: boolean) {
  if (cancelled) {
    return "The workflow was cancelled or timed out.";
  }

  if (error instanceof GitHubServiceError) {
    return error.message;
  }

  console.error("PR review workflow failed.", error);
  return "The PR review workflow could not be completed. Check the server configuration and try again.";
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonError("Request body is too large.", 413);
  }

  let body: unknown;

  try {
    const rawBody = await request.text();

    if (encoder.encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return jsonError("Request body is too large.", 413);
    }

    body = JSON.parse(rawBody);
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const parsed = getPullRequestReviewValidationMessage(body);

  if (!parsed.success) {
    return jsonError(parsed.message, 400);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const run = await prReviewWorkflow.createRunAsync({ disableScorers: true });
      let cancelled = false;
      const cancelRun = () => {
        cancelled = true;
        void run.cancel();
      };
      const timeout = setTimeout(cancelRun, WORKFLOW_TIMEOUT_MS);

      request.signal.addEventListener("abort", cancelRun, { once: true });

      try {
        const workflowStream = run.stream({ inputData: parsed.data });
        writeEvent(controller, {
          type: "meta",
          mode: isReviewMockMode() ? "mock" : "agent",
          workflowId: workflowStream.workflowId,
        });

        const reader = workflowStream.fullStream.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

            if (
              value.type === "workflow-step-start" &&
              value.payload.id in stepMessages
            ) {
              writeEvent(controller, {
                type: "progress",
                step: value.payload.id,
                status: "running",
                message: stepMessages[value.payload.id]!,
              });
            }

            if (
              value.type === "workflow-step-result" &&
              value.payload.status === "success" &&
              value.payload.id in stepMessages
            ) {
              writeEvent(controller, {
                type: "progress",
                step: value.payload.id,
                status: "complete",
                message: `${stepMessages[value.payload.id]!} 已完成。`,
              });
            }
          }
        } finally {
          reader.releaseLock();
        }

        const finalResult = await workflowStream.result;

        if (finalResult.status !== "success") {
          throw new Error("The workflow did not finish successfully.");
        }

        writeEvent(controller, {
          type: "result",
          output: PullRequestReviewOutputSchema.parse(finalResult.result),
        });
      } catch (error) {
        if (!request.signal.aborted) {
          writeEvent(controller, {
            type: "error",
            message: getSafeErrorMessage(error, cancelled),
          });
        }
      } finally {
        clearTimeout(timeout);
        request.signal.removeEventListener("abort", cancelRun);
        controller.close();
      }
    },
    cancel() {
      // The request abort listener above cancels the Mastra run.
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
