"use client";

import { useRef, useState } from "react";

import {
  ReviewStreamEventSchema,
  type ReviewResult,
  type ReviewStreamEvent,
} from "@/src/domain/review";
import styles from "./review-workbench.module.css";

const SAMPLE_DIFF = `diff --git a/src/user.ts b/src/user.ts
index 2aa1a2c..4bb3456 100644
--- a/src/user.ts
+++ b/src/user.ts
@@ -4,7 +4,7 @@ export async function getUser(id: string) {
-  const response = await fetch(\`/api/users/\${id}\`);
+  const response = await fetch(\`/api/users/\${id}\`);
   return response.json();
 }`;

type ReviewStatus = "idle" | "submitting" | "streaming" | "complete" | "error" | "cancelled";

const severityLabels = {
  critical: "严重",
  high: "高",
  medium: "中",
  low: "低",
  info: "提示",
};

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

  return "提交失败，请检查输入后重试。";
}

export function ReviewWorkbench() {
  const abortControllerRef = useRef<AbortController | null>(null);
  const [diff, setDiff] = useState(SAMPLE_DIFF);
  const [focus, setFocus] = useState("可靠性与错误处理");
  const [status, setStatus] = useState<ReviewStatus>("idle");
  const [progress, setProgress] = useState("准备就绪");
  const [streamedText, setStreamedText] = useState("");
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [mode, setMode] = useState<"mock" | "agent" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitReview() {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setStatus("submitting");
    setProgress("正在验证输入...");
    setStreamedText("");
    setResult(null);
    setMode(null);
    setError(null);

    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diff, focus }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as unknown;
        throw new Error(getResponseErrorMessage(payload));
      }

      if (!response.body) {
        throw new Error("服务器没有返回可读取的流。");
      }

      setStatus("streaming");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pendingLine = "";
      let receivedResult = false;

      function consumeLine(line: string) {
        if (!line.trim()) {
          return;
        }

        const event = ReviewStreamEventSchema.safeParse(JSON.parse(line));

        if (!event.success) {
          throw new Error("服务器返回了无法识别的流事件。");
        }

        const streamEvent: ReviewStreamEvent = event.data;

        switch (streamEvent.type) {
          case "meta":
            setMode(streamEvent.mode);
            break;
          case "progress":
            setProgress(streamEvent.message);
            break;
          case "text":
            setStreamedText((current) => current + streamEvent.value);
            break;
          case "result":
            receivedResult = true;
            setResult(streamEvent.result);
            setStatus("complete");
            setProgress("审查完成，已验证结构化结果。");
            break;
          case "error":
            throw new Error(streamEvent.message);
        }
      }

      while (true) {
        const { done, value } = await reader.read();
        pendingLine += decoder.decode(value, { stream: !done });

        const lines = pendingLine.split("\n");
        pendingLine = lines.pop() ?? "";
        lines.forEach(consumeLine);

        if (done) {
          break;
        }
      }

      if (pendingLine.trim()) {
        consumeLine(pendingLine);
      }

      if (!controller.signal.aborted && !receivedResult) {
        setStatus("error");
        setError("审查流结束，但没有收到最终结果。");
      }
    } catch (caughtError) {
      if (controller.signal.aborted) {
        setStatus("cancelled");
        setProgress("审查已取消。");
        return;
      }

      setStatus("error");
      setError(caughtError instanceof Error ? caughtError.message : "审查请求失败。");
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }

  function cancelReview() {
    abortControllerRef.current?.abort();
  }

  const isRunning = status === "submitting" || status === "streaming";

  return (
    <section className={styles.workbench} aria-labelledby="review-title">
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>PHASE 01 / REVIEW LOOP</span>
          <h2 id="review-title">提交一段 diff，观察 Agent 的工作过程。</h2>
        </div>
        <div className={styles.modeNote}>
          <span className={`${styles.modeDot} ${mode === "agent" ? styles.agent : ""}`} />
          {mode === "agent"
            ? "Mastra Agent 模式"
            : "未配置模型时自动使用 Mock 模式"}
        </div>
      </div>

      <div className={styles.grid}>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void submitReview();
          }}
        >
          <label className={styles.label} htmlFor="review-focus">
            审查关注点 <span>可选</span>
          </label>
          <input
            id="review-focus"
            maxLength={500}
            onChange={(event) => setFocus(event.target.value)}
            placeholder="例如：错误处理、并发或安全性"
            value={focus}
          />

          <div className={styles.labelRow}>
            <label className={styles.label} htmlFor="review-diff">
              代码 Diff
            </label>
            <button
              className={styles.sampleButton}
              onClick={() => setDiff(SAMPLE_DIFF)}
              type="button"
            >
              载入示例
            </button>
          </div>
          <textarea
            id="review-diff"
            maxLength={20_000}
            onChange={(event) => setDiff(event.target.value)}
            placeholder="粘贴 Unified Diff..."
            required
            rows={15}
            value={diff}
          />
          <div className={styles.inputFooter}>
            <span>{diff.length.toLocaleString()} / 20,000 字符</span>
            <span>仅分析，不执行代码</span>
          </div>

          <div className={styles.actions}>
            <button className={styles.submitButton} disabled={isRunning} type="submit">
              {isRunning ? "审查进行中..." : "开始审查"}
            </button>
            {isRunning ? (
              <button className={styles.cancelButton} onClick={cancelReview} type="button">
                取消
              </button>
            ) : null}
          </div>
        </form>

        <div className={styles.output} aria-live="polite">
          <div className={styles.outputTopline}>
            <span className={styles.status}>
              <span className={`${styles.statusDot} ${isRunning ? styles.pulsing : ""}`} />
              {progress}
            </span>
            <span className={styles.statusValue}>{status}</span>
          </div>

          {error ? <p className={styles.error}>{error}</p> : null}

          {streamedText ? (
            <div className={styles.streamPanel}>
              <span className={styles.panelLabel}>STREAMING TEXT</span>
              <pre>{streamedText}</pre>
            </div>
          ) : (
            <div className={styles.emptyState}>
              <span>等待一次审查请求</span>
              <p>流式文本会先出现，最终结果将按固定 schema 渲染。</p>
            </div>
          )}

          {result ? (
            <div className={styles.result}>
              <div className={styles.resultHeading}>
                <span className={styles.panelLabel}>STRUCTURED RESULT</span>
                <span>{result.findings.length} 个发现</span>
              </div>
              <p className={styles.summary}>{result.summary}</p>
              <div className={styles.findings}>
                {result.findings.map((finding, index) => (
                  <article className={styles.finding} key={`${finding.title}-${index}`}>
                    <div className={`${styles.severity} ${styles[finding.severity]}`}>
                      {severityLabels[finding.severity]}
                    </div>
                    <div>
                      <h3>{finding.title}</h3>
                      <p>{finding.explanation}</p>
                      <code>{finding.evidence}</code>
                      {finding.suggestion ? (
                        <p className={styles.suggestion}>建议：{finding.suggestion}</p>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
