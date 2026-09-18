"use client";

import { useState } from "react";

import {
  PullRequestContextSchema,
  type PullRequestContext,
} from "@/src/domain/github";
import styles from "./github-context-panel.module.css";

function getResponseErrorMessage(payload: unknown) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }

  return "无法加载 GitHub Pull Request 上下文。";
}

export function GitHubContextPanel() {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [pullNumber, setPullNumber] = useState("");
  const [context, setContext] = useState<PullRequestContext | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function loadContext() {
    const parsedPullNumber = Number(pullNumber);
    setStatus("loading");
    setError(null);
    setContext(null);

    try {
      const response = await fetch("/api/github/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner,
          repo,
          pullNumber: parsedPullNumber,
        }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        throw new Error(getResponseErrorMessage(payload));
      }

      const parsedContext = PullRequestContextSchema.safeParse(payload);

      if (!parsedContext.success) {
        throw new Error("服务器返回的 PR 上下文不符合预期格式。");
      }

      setContext(parsedContext.data);
      setStatus("idle");
    } catch (caughtError) {
      setStatus("error");
      setError(caughtError instanceof Error ? caughtError.message : "加载失败。");
    }
  }

  const isLoading = status === "loading";

  return (
    <section className={styles.panel} aria-labelledby="github-context-title">
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>PHASE 02 / READ-ONLY TOOLS</span>
          <h2 id="github-context-title">从 GitHub PR 取回受限的审查上下文。</h2>
        </div>
        <p className={styles.readOnly}>
          <span />
          GET only · fixed api.github.com · no writes
        </p>
      </div>

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void loadContext();
        }}
      >
        <label>
          Owner
          <input
            onChange={(event) => setOwner(event.target.value)}
            placeholder="例如 octocat"
            required
            value={owner}
          />
        </label>
        <label>
          Repository
          <input
            onChange={(event) => setRepo(event.target.value)}
            placeholder="例如 hello-world"
            required
            value={repo}
          />
        </label>
        <label>
          PR #
          <input
            inputMode="numeric"
            min="1"
            onChange={(event) => setPullNumber(event.target.value)}
            placeholder="42"
            required
            type="number"
            value={pullNumber}
          />
        </label>
        <button disabled={isLoading} type="submit">
          {isLoading ? "读取中..." : "预览上下文"}
        </button>
      </form>

      <p className={styles.tokenNote}>
        公开仓库可尝试匿名读取；私有仓库需要服务端配置只读 `GITHUB_TOKEN`。
      </p>

      {error ? <p className={styles.error}>{error}</p> : null}

      {context ? (
        <div className={styles.context}>
          <div className={styles.prSummary}>
            <div>
              <span className={styles.smallLabel}>PULL REQUEST</span>
              <h3>
                #{context.pullRequest.number} {context.pullRequest.title}
              </h3>
              <p>
                {context.pullRequest.baseRef} ← {context.pullRequest.headRef} ·{" "}
                {context.pullRequest.additions} additions · {context.pullRequest.deletions} deletions
              </p>
            </div>
            <a href={context.pullRequest.htmlUrl} rel="noreferrer" target="_blank">
              在 GitHub 打开 ↗
            </a>
          </div>

          <div className={styles.budget}>
            <span>{context.limits.filesFetched} files fetched</span>
            <span>{context.limits.filesSelected} selected</span>
            <span>{context.limits.patchCharacters.toLocaleString()} patch chars</span>
          </div>

          <div className={styles.columns}>
            <div>
              <div className={styles.listHeading}>
                <span className={styles.smallLabel}>SELECTED</span>
                <span>{context.selectedFiles.length}</span>
              </div>
              <ul className={styles.fileList}>
                {context.selectedFiles.map((file) => (
                  <li key={file.path}>
                    <code>{file.path}</code>
                    <p>{file.selectionReason}</p>
                    <span>
                      {file.patch ? `${file.additions} + / ${file.deletions} -` : "patch only"}
                      {file.content ? " · content loaded" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className={styles.listHeading}>
                <span className={styles.smallLabel}>SKIPPED</span>
                <span>{context.skippedFiles.length}</span>
              </div>
              <ul className={styles.fileList}>
                {context.skippedFiles.map((file) => (
                  <li key={file.path}>
                    <code>{file.path}</code>
                    <p>{file.reason}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.empty}>
          <span>尚未加载 PR</span>
          <p>模型只能通过注册的只读工具访问同一套受限上下文。</p>
        </div>
      )}
    </section>
  );
}
