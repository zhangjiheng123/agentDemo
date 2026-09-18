import { z } from "zod";

const GITHUB_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export const MAX_GITHUB_FILES_FETCHED = 100;
export const MAX_GITHUB_FILES_SELECTED = 12;
export const MAX_GITHUB_CONTENT_FILES = 8;
export const MAX_GITHUB_PATCH_CHARACTERS = 60_000;
export const MAX_GITHUB_FILE_CONTENT_CHARACTERS = 12_000;

export const PullRequestTargetSchema = z
  .object({
    owner: z
      .string()
      .regex(GITHUB_SEGMENT_PATTERN, "owner must be a GitHub-safe path segment"),
    repo: z
      .string()
      .regex(GITHUB_SEGMENT_PATTERN, "repo must be a GitHub-safe path segment"),
    pullNumber: z.number().int().positive().max(1_000_000),
  })
  .strict();

export const PullRequestMetadataSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.enum(["open", "closed"]),
  headSha: z.string().min(1),
  baseRef: z.string().min(1),
  headRef: z.string().min(1),
  changedFiles: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  htmlUrl: z.string().url(),
});

export const PullRequestFileStatusSchema = z.enum([
  "added",
  "modified",
  "removed",
  "renamed",
  "copied",
  "changed",
]);

export const PullRequestFileSchema = z.object({
  path: z.string().min(1),
  status: PullRequestFileStatusSchema,
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  patch: z.string().nullable(),
});

export const SkippedPullRequestFileSchema = z.object({
  path: z.string().min(1),
  reason: z.string().min(1),
});

export const SelectedPullRequestFileSchema = PullRequestFileSchema.extend({
  content: z.string().nullable(),
  selectionReason: z.string().min(1),
});

export const PullRequestFilesPreviewSchema = z.object({
  selectedFiles: z.array(SelectedPullRequestFileSchema),
  skippedFiles: z.array(SkippedPullRequestFileSchema),
  limits: z.object({
    filesFetched: z.number().int().nonnegative(),
    filesSelected: z.number().int().nonnegative(),
    patchCharacters: z.number().int().nonnegative(),
  }),
});

export const PullRequestContextSchema = PullRequestFilesPreviewSchema.extend({
  pullRequest: PullRequestMetadataSchema,
});

export type PullRequestTarget = z.infer<typeof PullRequestTargetSchema>;
export type PullRequestMetadata = z.infer<typeof PullRequestMetadataSchema>;
export type PullRequestFile = z.infer<typeof PullRequestFileSchema>;
export type SelectedPullRequestFile = z.infer<typeof SelectedPullRequestFileSchema>;
export type PullRequestFilesPreview = z.infer<typeof PullRequestFilesPreviewSchema>;
export type PullRequestContext = z.infer<typeof PullRequestContextSchema>;

const BINARY_EXTENSION_PATTERN =
  /\.(?:7z|avi|bmp|class|dll|docx?|eot|exe|gif|gz|ico|jar|jpeg|jpg|mov|mp3|mp4|otf|pdf|png|pptx?|so|tar|ttf|wav|webm|webp|woff2?|xls[xm]?|zip)$/i;
const GENERATED_FILE_PATTERN =
  /(?:^|\/)(?:dist|build|coverage|vendor|node_modules|\.next)\//i;
const GENERATED_NAME_PATTERN = /(?:\.min\.[cm]?js|\.map|\.generated\.[^/]+|\.gen\.[^/]+)$/i;
const LOCK_FILE_PATTERN =
  /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|composer\.lock|cargo\.lock|go\.sum)$/i;
const SOURCE_EXTENSION_PATTERN =
  /\.(?:c|cc|cpp|cs|css|go|html|java|js|jsx|json|kt|kts|mjs|php|py|rb|rs|scss|sh|sql|swift|toml|ts|tsx|vue|xml|yaml|yml)$/i;
const SOURCE_FILE_NAME_PATTERN =
  /(?:^|\/)(?:Dockerfile|Makefile|README(?:\.[^/]+)?|\.github\/workflows\/[^/]+)$/i;

export function selectReviewableFiles(files: PullRequestFile[]): PullRequestFilesPreview {
  const selectedFiles: SelectedPullRequestFile[] = [];
  const skippedFiles: Array<{ path: string; reason: string }> = [];
  let patchCharacters = 0;

  for (const file of files) {
    const skipReason = getSkipReason(file);

    if (skipReason) {
      skippedFiles.push({ path: file.path, reason: skipReason });
      continue;
    }

    const patchLength = file.patch?.length ?? 0;

    if (selectedFiles.length >= MAX_GITHUB_FILES_SELECTED) {
      skippedFiles.push({
        path: file.path,
        reason: `Skipped after reaching the ${MAX_GITHUB_FILES_SELECTED}-file review limit.`,
      });
      continue;
    }

    if (patchCharacters + patchLength > MAX_GITHUB_PATCH_CHARACTERS) {
      skippedFiles.push({
        path: file.path,
        reason: "Skipped because its patch would exceed the review patch budget.",
      });
      continue;
    }

    selectedFiles.push({
      ...file,
      content: null,
      selectionReason:
        file.status === "removed"
          ? "Selected for patch-only review because the file was removed."
          : "Selected as a reviewable source or configuration file.",
    });
    patchCharacters += patchLength;
  }

  return {
    selectedFiles,
    skippedFiles,
    limits: {
      filesFetched: files.length,
      filesSelected: selectedFiles.length,
      patchCharacters,
    },
  };
}

function getSkipReason(file: PullRequestFile) {
  const normalizedPath = file.path.replaceAll("\\", "/");

  if (LOCK_FILE_PATTERN.test(normalizedPath)) {
    return "Skipped lock or dependency-resolution file.";
  }

  if (GENERATED_FILE_PATTERN.test(normalizedPath) || GENERATED_NAME_PATTERN.test(normalizedPath)) {
    return "Skipped generated or build output file.";
  }

  if (BINARY_EXTENSION_PATTERN.test(normalizedPath)) {
    return "Skipped binary or media asset.";
  }

  if (!file.patch && file.status !== "removed") {
    return "Skipped because GitHub did not provide a textual patch.";
  }

  if (!SOURCE_EXTENSION_PATTERN.test(normalizedPath) && !SOURCE_FILE_NAME_PATTERN.test(normalizedPath)) {
    return "Skipped unsupported file type.";
  }

  return null;
}

export class GitHubServiceError extends Error {
  constructor(
    public readonly code: "bad_request" | "not_found" | "unauthorized" | "rate_limited" | "upstream_error",
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GitHubServiceError";
  }
}

export function mapGitHubError(status: number, rateLimitRemaining?: string | null) {
  if (status === 404) {
    return new GitHubServiceError(
      "not_found",
      "GitHub could not find this pull request. Check the repository, number, and token access.",
      404,
    );
  }

  if (status === 401) {
    return new GitHubServiceError(
      "unauthorized",
      "GitHub rejected the server token. Check its read-only permissions.",
      401,
    );
  }

  if (status === 429 || (status === 403 && rateLimitRemaining === "0")) {
    return new GitHubServiceError(
      "rate_limited",
      "GitHub rate limit reached. Wait before trying again or configure a read-only token.",
      429,
    );
  }

  if (status === 403) {
    return new GitHubServiceError(
      "unauthorized",
      "GitHub denied access to this pull request. Check read permissions.",
      403,
    );
  }

  return new GitHubServiceError(
    "upstream_error",
    "GitHub could not complete the request. Try again shortly.",
    502,
  );
}
