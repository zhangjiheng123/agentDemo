# 阶段 2：GitHub 工具调用与权限边界

## 项目背景和业务目标

阶段 1 的 Agent 可以审查用户粘贴的 diff，但真实业务里 diff、PR 描述、变更文件和当前版本内容都来自 GitHub。阶段 2 的目标是把“读取 GitHub PR”做成受控工具能力，而不是让模型拼接任意 URL 或直接访问网络。

本阶段交付：

- 读取 PR 元信息。
- 有上限地分页读取变更文件和 patch。
- 用确定性规则筛选适合审查的源文件。
- 在 PR 的 `head SHA` 读取选中内容。
- 将三项能力注册成 Mastra 的只读 Tool。
- 提供无模型调用的 PR 上下文预览页面。

## 架构设计

```text
Browser
  -> POST /api/github/pr
  -> PullRequestTargetSchema
  -> GitHubClient
     -> GET /repos/{owner}/{repo}/pulls/{number}
     -> GET /repos/{owner}/{repo}/pulls/{number}/files
     -> GET /repos/{owner}/{repo}/contents/{path}?ref={headSha}
  -> selectReviewableFiles
  -> PullRequestContext JSON

Mastra Agent
  -> getPullRequest
  -> getPullRequestFiles
  -> getPullRequestContext
  -> same GitHubClient and selection policy
```

关键文件：

- `src/domain/github/index.ts`：输入/输出 schema、选择策略、错误类型。
- `src/services/github/client.ts`：固定 API host 的 REST client。
- `src/mastra/tools/github-pr-tools.ts`：`createTool` 注册。
- `app/api/github/pr/route.ts`：服务端预览接口。
- `app/components/github-context-panel.tsx`：输入仓库和 PR 编号、展示 selected/skipped 文件。

## 核心概念

### Tool 不是“任意函数”

Agent Tool 应该是一个有职责边界的能力单元。本项目的 Tool 输入只能是：

```ts
type PullRequestTarget = {
  owner: string;
  repo: string;
  pullNumber: number;
};
```

它不允许调用方提供 URL、Token、ref 或文件路径。这样即使模型产生了不可信参数，也无法把 Tool 变成 SSRF、任意仓库读取或 Token 转发通道。

### 为什么需要确定性文件筛选

把所有 PR 文件、锁文件和二进制资源直接给模型，会有三个问题：

- token 成本和延迟失控。
- 依赖升级和生成文件制造大量噪音。
- 模型注意力被低价值内容稀释。

因此选择策略优先于模型：

| 边界 | 当前上限 |
| --- | ---: |
| GitHub changed file records | 100 |
| 选中可审查文件 | 12 |
| patch 字符数 | 60,000 |
| 读取内容的文件数 | 8 |
| 单文件内容字符数 | 12,000 |

策略跳过 lock 文件、`dist`/`build`/`node_modules`、minified/map/generated 文件、二进制资源、未提供文本 patch 的文件和不支持的扩展名。每个跳过决定都会返回原因，避免黑盒过滤。

### 为什么使用 PR head SHA

一个 PR 的分支可能持续推进。如果调用方自行传入任意 `ref`，读取的内容可能不对应当前 PR。流程先从 PR metadata 拿到 `head.sha`，再用该 SHA 读取选中文件，确保 patch 与补充内容属于同一 PR 版本。

### Agent Tool 和预览 Route 如何分工

预览 Route 让用户在没有模型密钥时观察实际会送入 Agent 的上下文，便于调试筛选规则。Mastra Tool 使用同一个 `GitHubClient` 和选择器，后续由 Agent 或 Workflow 调用。

这种共享服务层避免两个风险：

- UI 展示的文件与 Agent 实际拿到的文件不同。
- Route 和 Tool 分别实现权限、超时和错误逻辑，长期产生漂移。

## 权限与安全设计

### 固定 host 和只读方法

GitHub client 将 base URL 固定为 `https://api.github.com`，所有请求指定 `GET`。没有写 API endpoint，也没有创建、评论、批准或合并 PR 的 Tool。

### Token 只在服务端

`GITHUB_TOKEN` 只由 `createGitHubClient()` 从服务端环境变量读取。前端提交的只有 owner、repo 和 pull number，Route 的响应不会包含 request headers、token 或 GitHub 原始错误体。

公开仓库允许没有 Token 的匿名读取，但会受 GitHub rate limit 约束。私有仓库推荐使用 fine-grained token，并只赋予 Pull requests 和 Contents 的 read 权限。

### 错误映射

GitHub 的 401、403、404、429 和其他错误不会直接透传。应用映射为：

- `not_found`：PR 不存在或 Token 看不到它。
- `unauthorized`：Token 无效或缺少读取权限。
- `rate_limited`：匿名或 Token 配额耗尽。
- `upstream_error`：网络、超时或 GitHub 服务失败。

这样用户知道下一步动作，同时不会看到内部 header、认证细节或服务实现。

## 为什么选择 native fetch

本阶段只有四个简单的 GET 请求。使用 native fetch 的优点是：

- 请求 host、method、timeout、header 和缓存策略都清晰可见。
- 不增加大型 SDK 依赖。
- 更适合学习 HTTP 边界和错误处理。

Octokit 的优点是更完整的 GitHub 类型、分页和重试生态；当项目加入 webhook、评论/Review mutation、GraphQL 或复杂认证时，可以评估迁移。此阶段刻意保持依赖最小。

## 常见问题和解决方式

### Q1：为什么不让模型自己决定读取哪些文件？

文件选择关系到权限、成本和稳定性，应该由确定性代码控制。模型可以解释代码，但不应在没有预算约束的情况下决定访问多少文件、哪条网络路径或哪个 ref。

### Q2：为什么 Tool 不接收 file path？

file path 若直接由模型传入，容易扩大读取范围。当前流程先读取 PR changed files，再只从已经选中的文件读取内容；调用方无法越过 PR 变更集去读取仓库任意文件。

### Q3：无 Token 能否用于生产？

公开 Demo 可以，但匿名 rate limit 低且不可控。生产系统应该为服务账户配置最小权限 Token，并对每个用户、仓库和请求做认证、限流和审计。

### Q4：删除的文件为什么只看 patch？

删除文件在 PR head SHA 中已经不存在，无法读取其当前内容；但 GitHub 提供的 patch 仍是审查删除影响的证据，所以将其标记为 patch-only review。

### Q5：本阶段已经让 Agent 自动审查 GitHub PR 了吗？

工具已注册给 Agent，且 Agent instructions 限制其只能使用只读 GitHub Tool。但“拉取上下文、筛选、分析、汇总”的可靠编排还未实现，这是阶段 3 Workflow 的职责。阶段 2 重点是把工具能力、权限和数据边界做稳。

## 性能、稳定性与成本

- 文件记录、patch 和内容均有上限，避免单个大型 PR 占满模型上下文。
- GitHub 请求设置 10 秒 timeout。
- 文件列表最多两页，每页 50 条，总计 100 条。
- 只有最多 8 个选中非删除文件会额外读取内容。
- 预览 Route 不调用模型，排查 GitHub 权限问题不会产生 token 成本。
- 生产环境还应加入服务端限流、缓存、重试退避和 GitHub rate-limit 指标。

## 常见面试问题

### Q1：Agent Tool 的安全边界应如何设计？

从输入、网络、权限和输出四层设计。输入使用 schema 并禁止 URL/ref/token 等高风险字段；网络固定 host 和 method；权限使用最小 read-only Token；输出限制数据大小且不返回敏感 headers。模型只在这个边界内选择 Tool，不能扩大能力范围。

### Q2：为什么要把 Tool 和 HTTP Route 复用同一 Service？

两者都需要读取同一份 GitHub PR 数据。如果各自实现 API 调用和筛选规则，预览和 Agent 的结果可能不同，也会重复维护鉴权、超时和错误映射。把这些放在 Service 层，Route 和 Tool 只是不同入口。

### Q3：如何避免大 PR 造成成本爆炸？

在模型之前设预算：最大文件数、最大 patch 字符数、最大内容文件数和单文件内容上限；跳过锁文件、生成文件和二进制；后续还会按语义分块、检索和重排。关键思想是先缩小可信问题空间，再调用模型。

### Q4：为什么不直接传 GitHub diff URL 给模型？

这会失去访问控制、错误处理、大小限制和可观测性，也无法保证模型访问的版本与 PR head 一致。通过服务端 Tool，系统可以固定 host、校验参数、使用受控 Token，并记录上下文来源。

## 后续优化方向

- 阶段 3：使用 Workflow 串行拉取、筛选、分析和汇总，并加入超时、重试和中间状态。
- 阶段 4：为 selected files 补充 README、编码规范和历史 Review 的 RAG 检索。
- 阶段 5：接入用户/仓库授权、Token 权限校验、工具审批和 Prompt Injection 防护。
- 阶段 6：记录 GitHub API 延迟、rate limit、选中文件数量和模型成本，建立真实 PR 测试集。
