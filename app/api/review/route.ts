import { prReviewAgent } from "@/src/mastra/agents/pr-review-agent";
import {
  ReviewResultSchema,
  type ReviewRequest,
  type ReviewStreamEvent,
  getReviewValidationMessage,
  buildReviewPrompt,
} from "@/src/domain/review";
import { streamMockReview } from "@/src/domain/review/mock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 25 * 1024;
const REVIEW_TIMEOUT_MS = 30_000;
const encoder = new TextEncoder();

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
  event: ReviewStreamEvent,
) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

function isMockMode() {
  return process.env.REVIEW_MODE === "mock" || !process.env.OPENAI_API_KEY;
}

function getSafeErrorMessage(error: unknown, signal: AbortSignal) {
  if (signal.aborted) {
    return "The review took too long or was cancelled. Please try a smaller diff.";
  }

  console.error("Review request failed.", error);
  return "The review could not be completed. Check the server model configuration and try again.";
}

async function streamAgentReview(
  request: ReviewRequest,
  signal: AbortSignal,
  emit: (event: ReviewStreamEvent) => void,
) {
  emit({ type: "progress", message: "Mastra agent is reviewing the diff." });

  const response = await prReviewAgent.stream(buildReviewPrompt(request), {
    abortSignal: signal,
    maxSteps: 1,
    structuredOutput: {
      schema: ReviewResultSchema,
      errorStrategy: "strict",
      instructions:
        "Return the review result using the provided schema. Every evidence field must quote or identify supplied diff content only.",
    },
  });

  const reader = response.textStream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (value) {
        emit({ type: "text", value });
      }
    }
  } finally {
    reader.releaseLock();
  }

  emit({ type: "progress", message: "Validating the final structured review." });
  const result = ReviewResultSchema.parse(await response.object);
  emit({ type: "result", result });
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

  const parsed = getReviewValidationMessage(body);

  if (!parsed.success) {
    return jsonError(parsed.message, 400);
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), REVIEW_TIMEOUT_MS);

  request.signal.addEventListener(
    "abort",
    () => abortController.abort(),
    { once: true },
  );

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ReviewStreamEvent) => writeEvent(controller, event);

      try {
        const mockMode = isMockMode();
        emit({ type: "meta", mode: mockMode ? "mock" : "agent" });

        if (mockMode) {
          for await (const event of streamMockReview(parsed.data, {
            signal: abortController.signal,
          })) {
            emit(event);
          }
        } else {
          await streamAgentReview(parsed.data, abortController.signal, emit);
        }
      } catch (error) {
        if (!request.signal.aborted) {
          emit({
            type: "error",
            message: getSafeErrorMessage(error, abortController.signal),
          });
        }
      } finally {
        clearTimeout(timeout);
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
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
