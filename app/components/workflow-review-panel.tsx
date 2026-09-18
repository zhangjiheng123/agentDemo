"use client";

import { useRef, useState } from "react";

import {
  PullRequestReviewStreamEventSchema,
  type PullRequestReviewOutput,
  type PullRequestReviewStreamEvent,
} from "@/src/domain/workflow";
import styles from "./workflow-review-panel.module.css";

type WorkflowStatus = "idle" | "running" | "complete" | "error" | "cancelled";
type StepStatus = "pending" | "running" | "complete";

const workflowSteps = [
  { id: "validate-review-request", label: "验证输入" },
  { id: "fetch-pr-context", label: "读取上下文" },
  { id: "retrieve-review-guidance", label: "检索规则" },
  { id: "create-empty-review", label: "空上下文分支" },
  { id: "analyze-pr-context", label: "分析 PR" },
  { id: "aggregate-review-result", label: "汇总结果" },
];

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

  return "无法启动 PR Review Workflow。";
}

export function WorkflowReviewPanel() {
  const abortControllerRef = useRef<AbortController | null>(null);
  const [owner, setOwner] = useState("octocat");
  const [repo, setRepo] = useState("Hello-World");
  const [pullNumber, setPullNumber] = useState("1");
  const [focus, setFocus] = useState("可靠性与错误处理");
  const [promptVersion, setPromptVersion] = useState<"baseline-v1" | "evidence-v2">(
    "evidence-v2",
  );
  const [status, setStatus] = useState<WorkflowStatus>("idle");
  const [progress, setProgress] = useState("等待提交 GitHub PR。");
  const [mode, setMode] = useState<"mock" | "agent" | null>(null);
  const [output, setOutput] = useState<PullRequestReviewOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepState, setStepState] = useState<Record<string, StepStatus>>({});

  async function submitWorkflow() {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setStatus("running");
    setProgress("正在创建 Workflow 运行。");
    setMode(null);
    setOutput(null);
    setError(null);
    setStepState({});

    try {
      const response = await fetch("/api/workflows/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner,
          repo,
          pullNumber: Number(pullNumber),
          focus,
          promptVersion,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as unknown;
        throw new Error(getResponseErrorMessage(payload));
      }

      if (!response.body) {
        throw new Error("服务器没有返回可读取的 Workflow 流。");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pendingLine = "";
      let receivedResult = false;

      function consumeLine(line: string) {
        if (!line.trim()) {
          return;
        }

        const event = PullRequestReviewStreamEventSchema.safeParse(JSON.parse(line));

        if (!event.success) {
          throw new Error("服务器返回了无法识别的 Workflow 事件。");
        }

        consumeEvent(event.data);
      }

      function consumeEvent(event: PullRequestReviewStreamEvent) {
        switch (event.type) {
          case "meta":
            setMode(event.mode);
            break;
          case "progress":
            setProgress(event.message);
            setStepState((current) => ({
              ...current,
              [event.step]: event.status,
            }));
            break;
          case "result":
            receivedResult = true;
            setOutput(event.output);
            setProgress("Workflow 完成，结构化结果已验证。");
            setStatus("complete");
            break;
          case "error":
            throw new Error(event.message);
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
        throw new Error("Workflow 流结束，但没有收到最终结果。");
      }
    } catch (caughtError) {
      if (controller.signal.aborted) {
        setStatus("cancelled");
        setProgress("Workflow 已取消。");
        return;
      }

      setStatus("error");
      setError(caughtError instanceof Error ? caughtError.message : "Workflow 请求失败。");
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }

  function cancelWorkflow() {
    abortControllerRef.current?.abort();
  }

  const isRunning = status === "running";

  return (
    <section className={styles.panel} aria-labelledby="workflow-review-title">
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>PHASE 04 / PROMPT + RAG</span>
          <h2 id="workflow-review-title">用检索到的规则，为 PR Review 补齐上下文。</h2>
        </div>
        <p className={styles.mode}>
          <span className={mode === "agent" ? styles.agentDot : undefined} />
          {mode === "agent" ? "Mastra Agent 分析" : "默认可用 Mock 编排"}
        </p>
      </div>

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void submitWorkflow();
        }}
      >
        <label>
          Owner
          <input
            onChange={(event) => setOwner(event.target.value)}
            required
            value={owner}
          />
        </label>
        <label>
          Repository
          <input
            onChange={(event) => setRepo(event.target.value)}
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
            required
            type="number"
            value={pullNumber}
          />
        </label>
        <label className={styles.focus}>
          Review focus
          <input
            maxLength={500}
            onChange={(event) => setFocus(event.target.value)}
            value={focus}
          />
        </label>
        <label>
          Prompt policy
          <select
            onChange={(event) =>
              setPromptVersion(event.target.value as "baseline-v1" | "evidence-v2")
            }
            value={promptVersion}
          >
            <option value="baseline-v1">baseline-v1</option>
            <option value="evidence-v2">evidence-v2</option>
          </select>
        </label>
        <div className={styles.actions}>
          <button disabled={isRunning} type="submit">
            {isRunning ? "运行中..." : "运行 Workflow"}
          </button>
          {isRunning ? (
            <button className={styles.cancel} onClick={cancelWorkflow} type="button">
              取消
            </button>
          ) : null}
        </div>
      </form>

      <div className={styles.progress} aria-live="polite">
        <div className={styles.progressTop}>
          <span>
            <i className={isRunning ? styles.pulsing : undefined} />
            {progress}
          </span>
          <code>{status}</code>
        </div>
        <ol className={styles.stepList}>
          {workflowSteps.map((step) => {
            const current = stepState[step.id] ?? "pending";

            return (
              <li className={styles[current]} key={step.id}>
                <span>{current === "complete" ? "✓" : current === "running" ? "●" : "○"}</span>
                {step.label}
              </li>
            );
          })}
        </ol>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      {output ? (
        <div className={styles.output}>
          <div className={styles.outputHeading}>
            <span>STRUCTURED REVIEW RESULT</span>
            <code>
              {output.reviewable ? `${output.result.findings.length} findings` : "context limited"} ·{" "}
              {output.promptVersion}
            </code>
          </div>
          <p className={styles.summary}>{output.result.summary}</p>
          <div className={styles.contextStats}>
            <span>{output.context.selectedFileCount} selected files</span>
            <span>{output.context.skippedFileCount} skipped files</span>
            <span>{output.context.patchCharacters.toLocaleString()} patch chars</span>
            <span>{output.guidance.embeddingMode} retrieval</span>
          </div>
          <div className={styles.citations}>
            <span>RETRIEVED GUIDANCE</span>
            {output.guidance.citations.length > 0 ? (
              <ul>
                {output.guidance.citations.map((citation) => (
                  <li key={citation.id}>
                    <code>{citation.path}</code>
                    <p>{citation.excerpt}</p>
                    <small>
                      {citation.id} · score {citation.score.toFixed(3)}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p>没有检索到可用规则片段。</p>
            )}
          </div>
          {output.result.findings.map((finding, index) => (
            <article className={styles.finding} key={`${finding.title}-${index}`}>
              <strong className={styles[finding.severity]}>{severityLabels[finding.severity]}</strong>
              <div>
                <h3>{finding.title}</h3>
                <p>{finding.explanation}</p>
                <code>{finding.evidence}</code>
                {finding.suggestion ? <p>建议：{finding.suggestion}</p> : null}
                {finding.sources?.length ? (
                  <p className={styles.sources}>来源：{finding.sources.join(" · ")}</p>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
