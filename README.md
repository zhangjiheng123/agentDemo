# GitHub PR Review Agent

一个使用 Next.js、TypeScript 和 Mastra 构建的 GitHub Pull Request 审查 Agent 学习项目。

项目不会一次性堆叠复杂能力，而是按阶段演进：

| 阶段 | 目标 | 状态 |
| --- | --- | --- |
| 0 | 工程初始化、环境变量、Mastra Agent 注册 | 已完成 |
| 1 | 基础 Agent、流式输出、结构化结果 | 已完成 |
| 2 | GitHub PR、文件和 diff 工具 | 已完成 |
| 3 | 多步骤 Workflow、条件分支、重试和超时 | 已完成 |
| 4 | Prompt 版本、规则检索、引用式 RAG | 已完成 |
| 5 | Memory、权限、人工确认和安全 | 规划中 |
| 6 | 评测、可观测性、成本和生产化 | 规划中 |

## 启动

```bash
npm install
Copy-Item .env.example .env.local
npm run dev
```

打开 `http://localhost:3000` 查看项目首页，打开 `http://localhost:3000/api/health` 验证服务端 Mastra 注册状态。

默认 `REVIEW_MODE=mock`，无需模型密钥即可验证输入校验、NDJSON 流式传输和结构化结果渲染。要使用真实模型，请在 `.env.local` 中配置 `OPENAI_API_KEY`，并删除 `REVIEW_MODE=mock` 或设置为其他值。

阶段 4 默认使用零成本的 `RAG_EMBEDDING_MODE=local`，用于练习 Markdown 解析、切分、混合检索、重排和引用上下文。配置服务端 `OPENAI_API_KEY` 后可设置 `RAG_EMBEDDING_MODE=openai`，使用 `RAG_EMBEDDING_MODEL=openai/text-embedding-3-small` 进行真实 embedding；失败会安全降级为本地检索。

## 目录

```text
app/                         Next.js 页面和 API Route
app/components/              阶段 1 的客户端交互组件
src/domain/review/           审查请求、结果、Prompt 与流事件契约
src/domain/github/           GitHub target、上下文和文件筛选契约
src/domain/workflow/         Workflow 输入、输出、事件、Mock 与安全 Prompt
src/domain/rag/              RAG chunk、citation、混合排序和本地向量契约
src/services/github/         固定 host 的 GitHub 只读 REST client
src/services/rag/            固定知识源读取、embedding 和检索服务
src/mastra/agents/           Agent 定义
src/mastra/tools/            Mastra 只读 GitHub 工具
src/mastra/workflows/        PR Review Workflow 定义
docs/interview/              分阶段技术面试文档
docs/knowledge-base/         可检索的审查规则与历史 Review
docs/evals/                  固定 Prompt / RAG 评测案例
.env.example                 环境变量模板
```

## 验证

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## 学习文档

- [阶段 0：工程初始化与 Mastra 基线](docs/interview/phase-0-engineering-foundation.md)
- [阶段 1：基础 Agent、流式输出与结构化结果](docs/interview/phase-1-basic-agent.md)
- [阶段 2：GitHub 工具调用与权限边界](docs/interview/phase-2-github-tools.md)
- [阶段 3：Workflow 编排、条件分支与可观察执行](docs/interview/phase-3-review-workflow.md)
- [阶段 4：Prompt 工程与可引用 RAG 上下文](docs/interview/phase-4-prompt-rag-context.md)
