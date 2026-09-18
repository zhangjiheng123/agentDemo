import { Buffer } from "node:buffer";

import {
  GitHubServiceError,
  MAX_GITHUB_CONTENT_FILES,
  MAX_GITHUB_FILE_CONTENT_CHARACTERS,
  MAX_GITHUB_FILES_FETCHED,
  PullRequestContextSchema,
  PullRequestFileSchema,
  PullRequestMetadataSchema,
  type PullRequestContext,
  type PullRequestFile,
  type PullRequestFilesPreview,
  type PullRequestMetadata,
  type PullRequestTarget,
  mapGitHubError,
  selectReviewableFiles,
} from "@/src/domain/github";

const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_REQUEST_TIMEOUT_MS = 10_000;
const FILES_PER_PAGE = 50;
const MAX_FILE_PAGES = MAX_GITHUB_FILES_FETCHED / FILES_PER_PAGE;

type FetchImplementation = typeof fetch;

type GitHubPullRequestResponse = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  head: { sha: string; ref: string };
  base: { ref: string };
  changed_files: number;
  additions: number;
  deletions: number;
  html_url: string;
};

type GitHubPullRequestFileResponse = {
  filename: string;
  status: PullRequestFile["status"];
  additions: number;
  deletions: number;
  patch?: string;
};

type GitHubContentResponse = {
  type: string;
  encoding: string;
  content: string;
};

export class GitHubClient {
  constructor(
    private readonly options: {
      fetchImplementation?: FetchImplementation;
      token?: string;
    } = {},
  ) {}

  async getPullRequest(
    target: PullRequestTarget,
    signal?: AbortSignal,
  ): Promise<PullRequestMetadata> {
    const response = await this.getJson<GitHubPullRequestResponse>(
      `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/pulls/${target.pullNumber}`,
      signal,
    );

    return PullRequestMetadataSchema.parse({
      number: response.number,
      title: response.title,
      body: response.body,
      state: response.state,
      headSha: response.head.sha,
      baseRef: response.base.ref,
      headRef: response.head.ref,
      changedFiles: response.changed_files,
      additions: response.additions,
      deletions: response.deletions,
      htmlUrl: response.html_url,
    });
  }

  async listPullRequestFiles(
    target: PullRequestTarget,
    signal?: AbortSignal,
  ): Promise<PullRequestFile[]> {
    const files: PullRequestFile[] = [];

    for (let page = 1; page <= MAX_FILE_PAGES; page += 1) {
      const response = await this.getJson<GitHubPullRequestFileResponse[]>(
        `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/pulls/${target.pullNumber}/files?per_page=${FILES_PER_PAGE}&page=${page}`,
        signal,
      );

      const normalized = response.map((file) =>
        PullRequestFileSchema.parse({
          path: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch ?? null,
        }),
      );

      files.push(...normalized);

      if (response.length < FILES_PER_PAGE || files.length >= MAX_GITHUB_FILES_FETCHED) {
        break;
      }
    }

    return files.slice(0, MAX_GITHUB_FILES_FETCHED);
  }

  async getPullRequestContext(
    target: PullRequestTarget,
    signal?: AbortSignal,
  ): Promise<PullRequestContext> {
    const pullRequest = await this.getPullRequest(target, signal);
    const files = await this.listPullRequestFiles(target, signal);
    const preview = selectReviewableFiles(files);
    const selectedFiles = await this.loadSelectedFileContent(
      target,
      pullRequest.headSha,
      preview,
      signal,
    );

    return PullRequestContextSchema.parse({
      pullRequest,
      ...preview,
      selectedFiles,
    });
  }

  private async loadSelectedFileContent(
    target: PullRequestTarget,
    ref: string,
    preview: PullRequestFilesPreview,
    signal?: AbortSignal,
  ) {
    let contentFilesRead = 0;

    return Promise.all(
      preview.selectedFiles.map(async (file) => {
        if (file.status === "removed" || contentFilesRead >= MAX_GITHUB_CONTENT_FILES) {
          return file;
        }

        contentFilesRead += 1;

        try {
          const content = await this.getFileContent(target, file.path, ref, signal);

          return {
            ...file,
            content,
            selectionReason:
              content.length >= MAX_GITHUB_FILE_CONTENT_CHARACTERS
                ? `${file.selectionReason} Content was truncated to the per-file limit.`
                : file.selectionReason,
          };
        } catch (error) {
          if (error instanceof GitHubServiceError && error.code === "not_found") {
            return {
              ...file,
              selectionReason: `${file.selectionReason} Content was unavailable at the PR head SHA.`,
            };
          }

          throw error;
        }
      }),
    );
  }

  private async getFileContent(
    target: PullRequestTarget,
    path: string,
    ref: string,
    signal?: AbortSignal,
  ) {
    const response = await this.getJson<GitHubContentResponse>(
      `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/contents/${path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}?ref=${encodeURIComponent(ref)}`,
      signal,
    );

    if (response.type !== "file" || response.encoding !== "base64") {
      throw new GitHubServiceError(
        "upstream_error",
        "GitHub returned unsupported file content.",
        502,
      );
    }

    return Buffer.from(response.content.replaceAll("\n", ""), "base64")
      .toString("utf8")
      .slice(0, MAX_GITHUB_FILE_CONTENT_CHARACTERS);
  }

  private async getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    const fetchImplementation = this.options.fetchImplementation ?? fetch;
    const timeout = new AbortController();
    const timeoutId = setTimeout(() => timeout.abort(), GITHUB_REQUEST_TIMEOUT_MS);
    const abortRequest = () => timeout.abort();

    if (signal?.aborted) {
      timeout.abort();
    } else {
      signal?.addEventListener("abort", abortRequest, { once: true });
    }

    try {
      const response = await fetchImplementation(`${GITHUB_API_BASE_URL}${path}`, {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github+json",
          ...(this.options.token ? { Authorization: `Bearer ${this.options.token}` } : {}),
          "User-Agent": "mastra-pr-review-agent",
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
        signal: timeout.signal,
      });

      if (!response.ok) {
        throw mapGitHubError(response.status, response.headers.get("x-ratelimit-remaining"));
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof GitHubServiceError) {
        throw error;
      }

      if (timeout.signal.aborted) {
        throw new GitHubServiceError(
          "upstream_error",
          "GitHub did not respond before the request timeout.",
          504,
        );
      }

      throw new GitHubServiceError(
        "upstream_error",
        "GitHub could not be reached. Check the network connection and try again.",
        502,
      );
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abortRequest);
    }
  }
}

export function createGitHubClient() {
  return new GitHubClient({
    token: process.env.GITHUB_TOKEN,
  });
}
