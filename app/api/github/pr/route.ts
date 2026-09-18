import {
  GitHubServiceError,
  PullRequestTargetSchema,
} from "@/src/domain/github";
import { createGitHubClient } from "@/src/services/github/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 2 * 1024;

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

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonError("Request body is too large.", 413);
  }

  let body: unknown;

  try {
    const rawBody = await request.text();

    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return jsonError("Request body is too large.", 413);
    }

    body = JSON.parse(rawBody);
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const target = PullRequestTargetSchema.safeParse(body);

  if (!target.success) {
    return jsonError("Provide a valid GitHub owner, repository, and positive pull number.", 400);
  }

  try {
    const context = await createGitHubClient().getPullRequestContext(target.data);

    return Response.json(context, {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof GitHubServiceError) {
      return jsonError(error.message, error.status);
    }

    console.error("GitHub PR context request failed.", error);
    return jsonError("The GitHub context could not be loaded.", 502);
  }
}
