import styles from "./page.module.css";
import { GitHubContextPanel } from "./components/github-context-panel";
import { ReviewWorkbench } from "./components/review-workbench";
import { WorkflowReviewPanel } from "./components/workflow-review-panel";

const phases = [
  { number: "00", title: "工程初始化", detail: "Next.js + TypeScript + Mastra", state: "已完成" },
  { number: "01", title: "基础 Agent", detail: "流式输出与结构化结果", state: "已完成" },
  { number: "02", title: "GitHub 工具", detail: "读取 PR、文件与 diff", state: "已完成" },
  { number: "03", title: "Workflow 化", detail: "拆分任务、分支与重试", state: "已完成" },
  { number: "04", title: "上下文与 RAG", detail: "Prompt、规则检索与引用", state: "已完成" },
  { number: "05", title: "Memory 与安全", detail: "偏好、权限与人工确认", state: "规划中" },
  { number: "06", title: "评测与生产化", detail: "质量、成本、可观测性", state: "规划中" },
];

export default function Home() {
  return (
    <div className={styles.page}>
      <main>
        <section className={styles.hero}>
          <div className={styles.kicker}>MASTRA / LEARNING PROJECT / 2026</div>
          <div className={styles.heroGrid}>
            <div>
              <h1>
                把一次
                <br />
                <em>PR Review</em>
                <br />
                做成一个 Agent。
              </h1>
            </div>
            <div className={styles.heroNote}>
              <p>
                一个从前端开发出发，逐阶段学习 Agent 工程的 GitHub Pull Request
                审查项目。
              </p>
              <span className={styles.statusPill}>
                <span className={styles.statusDot} />
                阶段 3 · Workflow 已接入
              </span>
            </div>
          </div>
        </section>

        <ReviewWorkbench />
        <GitHubContextPanel />
        <WorkflowReviewPanel />

        <section className={styles.dashboard}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>PROJECT MAP</span>
              <h2>从能运行，到能解释。</h2>
            </div>
            <a className={styles.healthLink} href="/api/health">
              查看服务状态 <span>↗</span>
            </a>
          </div>

          <div className={styles.phaseList}>
            {phases.map((phase, index) => (
              <article
                className={`${styles.phaseCard} ${index === 3 ? styles.active : ""}`}
                key={phase.number}
              >
                <div className={styles.phaseNumber}>{phase.number}</div>
                <div className={styles.phaseContent}>
                  <div className={styles.phaseMeta}>{phase.state}</div>
                  <h3>{phase.title}</h3>
                  <p>{phase.detail}</p>
                </div>
                <div className={styles.arrow}>{index === 3 ? "●" : "○"}</div>
              </article>
            ))}
          </div>
        </section>

        <footer className={styles.footer}>
          <span>GitHub PR Review Agent</span>
          <span>Built for understanding, not magic.</span>
        </footer>
      </main>
    </div>
  );
}
