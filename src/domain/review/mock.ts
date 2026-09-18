import type { ReviewRequest, ReviewResult, ReviewStreamEvent } from ".";

function getEvidence(diff: string) {
  const candidate = diff
    .split("\n")
    .find((line) => line.startsWith("+") && !line.startsWith("+++"));

  return (candidate ?? diff.trim().split("\n")[0] ?? "No diff content available").slice(0, 500);
}

export function createMockReview(request: ReviewRequest): ReviewResult {
  const focusSuffix = request.focus?.trim()
    ? ` The requested focus was: ${request.focus.trim()}.`
    : "";

  return {
    summary:
      "Mock review completed. This deterministic response verifies the request, streaming, and structured-result paths without a model call." +
      focusSuffix,
    findings: [
      {
        severity: "info",
        title: "Mock mode is active",
        explanation:
          "This finding is intentionally deterministic and does not judge code quality. Add OPENAI_API_KEY to use the configured Mastra agent.",
        evidence: getEvidence(request.diff),
        suggestion:
          "Use this mode to verify UI states and transport behavior before spending tokens on a provider call.",
      },
    ],
  };
}

function wait(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);

    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new DOMException("The review request was cancelled.", "AbortError"));
      },
      { once: true },
    );
  });
}

export async function* streamMockReview(
  request: ReviewRequest,
  options: { delayMs?: number; signal?: AbortSignal } = {},
): AsyncGenerator<ReviewStreamEvent> {
  const delayMs = options.delayMs ?? 120;

  yield { type: "progress", message: "Mock mode is preparing the review context." };
  await wait(delayMs, options.signal);
  yield {
    type: "text",
    value: "The server accepted the diff and is streaming a deterministic review.\n",
  };
  await wait(delayMs, options.signal);
  yield { type: "progress", message: "Mock mode is producing the structured result." };
  await wait(delayMs, options.signal);
  yield {
    type: "text",
    value: "The final result is validated against the review schema.\n",
  };
  yield { type: "result", result: createMockReview(request) };
}
