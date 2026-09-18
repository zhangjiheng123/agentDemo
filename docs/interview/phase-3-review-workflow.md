# 阶段 3：Workflow 编排、条件分支与可观察执行

## 项目背景和业务目标

阶段 2 已经能安全读取 GitHub PR，但“读什么、什么时候读、没有可审查文件怎么办、模型何时运行”仍然没有被明确建模。真实 AI 应用不能只依赖模型在一次对话里临场决定顺序，否则流程很难重试、观测、测试和控制成本。

阶段 3 将端到端 PR Review 固定为 Mastra Workflow：

```text
验证 PR 目标
  -> 读取受限 GitHub 上下文
  -> 条件分支
     -> 没有可审查文件：返回安全空结果
     -> 有可审查文件：Mock 或 Agent 分析
  -> 汇总为稳定的结构化结果
```

浏览器会收到每个步骤的开始和完成事件，因此用户能区分“还在拉 GitHub”“正在分析”与“结果已验证”。

## 架构与职责边界

```text
Browser
  -> POST /api/workflows/review
  -> Route Handler: HTTP 校验、超时、取消、NDJSON
  -> Mastra prReviewWorkflow
     -> validate-review-request
     -> fetch-pr-context
     -> create-empty-review OR analyze-pr-context
     -> aggregate-review-result
  -> structured PullRequestReviewOutput

GitHubClient: 固定 host、GET only、文件选择与读取上限
Agent: 只解释 Workflow 已经准备好的受限上下文
Workflow: 顺序、分支、重试边界、步骤状态
UI: 提交、观察步骤、取消、渲染结果
```

关键代码：

- `src/domain/workflow/index.ts`：Workflow 输入/输出/event schema、上下文摘要、Mock 结果和安全 Prompt。
- `src/mastra/workflows/pr-review-workflow.ts`：Mastra `createStep`、`createWorkflow`、分支、重试和 Agent 调用。
- `app/api/workflows/review/route.ts`：把 Mastra 事件映射为应用 NDJSON 协议。
- `app/components/workflow-review-panel.tsx`：PR 表单、步骤时间线、取消和结构化结果。
- `src/services/github/client.ts`：现在可接收 `AbortSignal`，使 Workflow 取消能向 GitHub 请求传播。

## 核心概念

### Agent 与 Workflow 的区别

Agent 擅长不确定性任务，例如根据 patch 解释潜在风险、生成原因和建议。Workflow 擅长确定性流程，例如“先校验、再拉取、再判断是否为空、最后分析”。两者不是替代关系：

- Workflow 决定是否调用 Agent、输入是什么、失败如何处理。
- Agent 在最小权限和受限上下文内做语义判断。

这个项目刻意不让 Agent 自主选择 GitHub Tool。Tool 已经在阶段 2 注册，但首个生产化审查流优先保证可预测性：Workflow 直接调用共享 `GitHubClient`，从而固定调用顺序、文件预算和错误边界。

### 为什么需要条件分支

GitHub 可能只返回锁文件、二进制文件、生成文件，或者没有文本 patch。如果仍把空上下文送到模型，模型可能为了“完成任务”编造问题。

因此分支条件只依赖确定性事实：

```ts
context.selectedFiles.length === 0
```

空分支返回：

```ts
{
  reviewable: false,
  result: {
    summary: "没有可审查文本文件",
    findings: []
  }
}
```

这体现了 Agent 系统的重要原则：信息不足时应明确拒绝推断，而不是制造看似合理的答案。

### Workflow Stream 和应用 Event

Mastra 会产生 `workflow-step-start`、`workflow-step-result` 等框架事件。浏览器不应该直接绑定这些内部细节，因此 Route Handler 将它们转换为项目自己的稳定协议：

```ts
{ type: "meta", mode: "mock" | "agent", workflowId: string }
{ type: "progress", step: string, status: "running" | "complete", message: string }
{ type: "result", output: PullRequestReviewOutput }
{ type: "error", message: string }
```

这样即使以后替换编排框架或调整 Mastra 事件字段，前端只需保持项目协议不变。

### 重试、超时和取消

GitHub Client 的单次 HTTP 请求上限仍是 10 秒。Workflow 在 `upstream_error` 时等待 250ms 后重试一次；404、401、403、429 不重试，因为它们通常不是瞬时网络失败。

Route Handler 为整个 Workflow 设置 45 秒上限。浏览器使用 `AbortController` 取消 `fetch`，Route Handler 调用 `run.cancel()`，Workflow Step 获得的 `AbortSignal` 再传入 GitHub 请求和 Agent 调用。

取消不代表远端模型服务一定立刻停止计费或停止计算，但它能阻止本应用继续等待、继续进入后续步骤或继续向浏览器写入结果。

## Prompt 与上下文安全

Phase 2 限制了文件数、patch 和文件内容，但它们加总后仍可能过大。因此阶段 3 的 Prompt Builder 还增加模型输入预算：

- PR title 最多 500 字符。
- PR body 最多 4,000 字符。
- 每个 patch 最多 6,000 字符。
- 每个文件内容最多 2,000 字符。
- 总模型上下文最多 80,000 字符。

每一类 GitHub 文本和用户 focus 都置于 `BEGIN_UNTRUSTED...` / `END_UNTRUSTED...` 分隔符之间。分隔符不是完整的 Prompt Injection 防护，但它明确了数据与指令的边界；更关键的是系统没有给 Agent 代码执行、任意网络或 GitHub 写入权限。

## 为什么选择当前方案

### 使用显式 Workflow，而不是一个大 Prompt

优点：

- 步骤、输入输出、分支和失败边界可见。
- 可以单测空分支，不依赖模型。
- 前端能展示真实执行状态。
- 后续可给每一步添加 Trace、指标、缓存或人工确认。

缺点：

- 文件和类型更多。
- 需要设计中间数据 schema。
- 小型一次性任务可能显得复杂。

对于 GitHub PR Review，这种复杂度是合理的：它天然包含外部读取、选择、分析和汇总多个职责。

### 为什么不并行拉取 PR metadata 和文件列表

当前 `getPullRequestContext` 先获取 PR metadata，再用 `headSha` 读取选中文件内容。metadata 与文件列表可以未来并行，但内容读取依赖 `headSha`，且当前实现优先保证版本一致和代码容易理解。阶段 6 会根据 trace 数据判断是否值得优化并发。

### 为什么 Mock 模式仍然访问真实 GitHub

Mock 只替代模型分析，不替代外部工具和编排。这样无需模型密钥也能演示真实的：参数校验、GitHub 权限、文件筛选、条件分支、流式步骤状态与取消。它不会假装发现真实代码问题。

## 常见问题与解决方式

### Q1：Workflow 是否应该直接调用 Tool？

两种方案都可以。直接调用 Tool 能统一工具注册和审计；直接调用共享 Service 则更适合固定业务编排，类型与依赖也更直接。本项目当前让 Tool 和 Workflow 复用同一 `GitHubClient`，确保权限、筛选和超时不漂移。未来若需要动态工具审批、统一 trace 或让多个 Agent 使用同一工具网关，可以让 Step 调用 Tool。

### Q2：为什么 Workflow 输入仍然要再校验一次？

Route Handler 的校验保护 HTTP 边界，Workflow 的 schema 保护内部编排边界。Workflow 未来可能由 CLI、队列、定时任务或其他 Agent 触发，不能假设所有调用都来自当前 API Route。

### Q3：为什么没有对所有失败重试？

重试只适合暂时性失败。网络 502 或 timeout 可能重试成功；404、权限不足和 rate limit 通常需要用户修正目标、Token 或等待配额。盲目重试会放大 GitHub 压力并延长用户等待。

### Q4：大 PR 的上下文会不会仍然超预算？

会有风险，因此有两层预算。阶段 2 限制 GitHub 数据读取，阶段 3 又限制真正送入模型的字符数。阶段 4 会进一步用切分、检索和重排，而不是线性截断全部文件。

## 性能、稳定性、安全和成本

- GitHub selection 在模型前执行，锁文件、二进制、生成文件不会占用模型 token。
- 80,000 字符模型上下文上限避免多个文件内容叠加失控。
- 无模型 Mock 模式可用于 UI、流程和 GitHub 权限测试，模型成本为零。
- whole-workflow timeout 避免 Next.js 请求无限挂起。
- 客户端取消会向 Workflow、GitHub fetch 和 Agent 调用传播。
- 错误只返回可行动的安全信息，不输出原始 GitHub header、Token、模型配置或不可信全文。
- 当前没有 durable run storage；服务重启会丢失运行状态，这在 demo 合理，但生产需要数据库/队列。

## 常见面试问题

### Q1：如何定义 Agent 和 Workflow 的职责边界？

Workflow 负责确定性的业务流程，包括输入校验、外部数据读取、条件分支、超时、重试、状态和最终聚合；Agent 负责需要语言理解的部分，例如根据受限代码上下文提出有证据的风险。这样模型不能绕过权限或扩大数据范围，系统也更容易测试和排错。

### Q2：为什么要把 Mastra Workflow event 转为自己定义的 NDJSON event？

框架事件属于基础设施内部协议，字段和语义可能随版本变化。前端绑定本地 event schema 可以减少框架耦合，并让 HTTP 协议明确表达 `progress`、`result` 和 `error` 三类业务状态。NDJSON 又能在一个 POST 请求中流式返回这些结构化事件。

### Q3：如何避免 Agent 在没有上下文时产生幻觉？

模型调用前做确定性判断。若 selected files 为空，Workflow 分支直接返回 `findings: []` 和原因，完全不调用模型。对于有上下文的情况，Prompt 要求每条 finding 都必须引用提供的 patch 或文件内容；后续还应把 evidence 做可定位校验和离线评测。

### Q4：取消请求如何传播？

浏览器通过 `AbortController` 取消 fetch；Route Handler 监听 `request.signal` 并执行 Mastra `run.cancel()`；Workflow Step 使用 Mastra 提供的 `abortSignal`，将其继续传给 GitHub Client 和 Agent。这样取消不是只隐藏 UI，而是尝试停止整个执行链。

### Q5：这一阶段为什么不让多个文件并行调用 Agent？

并行能降低长 PR 延迟，但会带来 token 成本、并发控制、结果去重和统一排序的问题。当前先证明单条可观察流程正确；后续应在 trace 数据证明串行分析是瓶颈后，再加入并行分片和汇总步骤。

## 可继续优化方向

- 阶段 4：给 Workflow 增加 README、规范和历史 Review 的检索步骤，给 finding 输出来源引用。
- 阶段 5：根据用户与仓库身份注入权限上下文，加入 Tool approval 和高风险操作确认。
- 阶段 6：为每步记录耗时、重试、文件数、token 用量和错误码；建立固定 PR 测试集，评估召回、准确性、成本和延迟。
- 生产化：接入 durable workflow storage、任务队列、幂等 key、服务端限流、缓存和分布式 trace。
