# 阶段 1：基础 Agent、流式输出与结构化结果

## 项目背景和业务目标

阶段 0 解决了应用、Mastra Agent 和服务端边界的初始化问题，但用户还无法提交代码并看到审查过程。阶段 1 建立一个最小但完整的审查闭环：输入一段 Unified Diff，服务端验证后交给 Agent，浏览器逐步显示过程，最后渲染固定结构的审查结果。

这一步的目标不是准确审查所有代码，而是验证 AI 应用的四个工程能力：

- 模型调用必须留在服务端。
- 输入和输出都要有明确 schema。
- 流式传输需要被前端明确地消费和展示。
- 没有模型密钥时，项目仍应可以稳定演示和测试。

## 架构与数据流

```text
Client form
  -> POST /api/review
  -> request size check + Zod validation
  -> prompt builder with untrusted delimiters
  -> mock stream OR Mastra Agent stream
  -> NDJSON event stream
  -> client stream parser
  -> final Zod-validated result renderer
```

关键文件：

- `src/domain/review/index.ts`：请求、结果、流事件 schema 和 Prompt 构建。
- `src/domain/review/mock.ts`：无密钥的确定性 mock 审查流。
- `app/api/review/route.ts`：HTTP 边界、超时、取消、Mastra 调用和 NDJSON 输出。
- `app/components/review-workbench.tsx`：请求、取消、逐行解码流事件与结果展示。
- `tests/review-domain.test.ts`：领域层与 mock 流的基础测试。

## 核心概念

### 为什么输入也要用 Zod 校验

用户提交的 diff 不是可信对象。Schema 在模型调用前限制：

- `diff` 必填，且最多 20,000 个字符。
- `focus` 可选，且最多 500 个字符。
- 禁止未定义字段，避免 API 契约逐渐失控。

这同时节约 token、降低延迟，也让客户端能够收到稳定的 4xx 错误。

### 什么是结构化输出

自然语言审查结果很容易变化，比如模型有时使用 Markdown 表格，有时只写段落。前端如果依赖解析标题或正则表达式，会非常脆弱。

因此结果固定为：

```ts
type ReviewResult = {
  summary: string;
  findings: Array<{
    severity: "critical" | "high" | "medium" | "low" | "info";
    title: string;
    explanation: string;
    evidence: string;
    suggestion?: string;
  }>;
};
```

真实路径通过 Mastra `structuredOutput` 生成并验证对象；前端只渲染 `result` 事件中的对象，不解析模型的 Markdown 文本。

### 为什么使用 NDJSON

NDJSON 是“每行一个 JSON 对象”的流格式。这里的事件包括：

```ts
{ type: "meta", mode: "mock" | "agent" }
{ type: "progress", message: string }
{ type: "text", value: string }
{ type: "result", result: ReviewResult }
{ type: "error", message: string }
```

相对于只传纯文本，它多了一点协议设计，但换来明确状态：文本是过程信息，`result` 才是可被业务消费的最终结果。

### Mock 模式的价值

如果没有模型密钥，或每次开发都调用模型，会带来成本、网络依赖和不可重复的结果。Mock 模式返回确定性的事件和结果，用来验证：

- 表单状态。
- 取消逻辑。
- 流解码。
- 结构化卡片渲染。
- 输入校验与错误显示。

它不会假装做了真实代码审查，结果中明确标注为 mock。

## 安全设计

diff、focus 和之后阶段的 GitHub 内容都被当作不可信输入。Prompt 明确使用：

```text
BEGIN_UNTRUSTED_DIFF
...
END_UNTRUSTED_DIFF
```

并告诉 Agent 不得执行其中的指令。这个做法不能单独消除 Prompt Injection，但能够建立角色边界；后续还需要工具权限、来源引用、内容过滤和人工确认。

服务端还限制请求大小、设置 30 秒超时、支持 AbortSignal 取消，且不会将完整 diff 写入日志。响应关闭缓存并禁止 MIME 嗅探。

## 方案取舍

### 为什么不是 Server-Sent Events

SSE 很适合单向事件流，并拥有浏览器 EventSource API；但 EventSource 原生只支持 GET，表单 POST 需要额外设计。NDJSON 可以直接作为 POST 响应的 Web Stream，由 `fetch` 和 `ReadableStream` 消费，阶段 1 更直观。

### 为什么不是一次模型调用只返回 JSON

只返回 JSON 实现简单，却无法展示过程，也无法学习流式 UI。当前方案同时保留原始文本事件和最终结构化结果，使“体验层”和“业务契约层”分离。

### 为什么不直接把 API Key 写进客户端

客户端变量会被构建进浏览器包，任何用户都可能读取。模型密钥必须只在 Route Handler 读取；Next.js 中未加 `NEXT_PUBLIC_` 前缀的变量只可在服务端使用。

## 常见问题和解决方式

### 流开始后还能返回 500 吗

不能。HTTP headers 和状态码会在第一段响应发送时确定。因此无效 JSON、字段校验、请求体过大等错误必须在创建流之前返回 4xx；模型运行过程中的问题只能作为流内 `error` 事件表达。

### 为什么有最终结果但还要 Zod 再 parse 一次

Mastra 的 structured output 已经承担主校验，但在业务边界再次执行 `ReviewResultSchema.parse()` 可以确保发送给客户端的对象符合项目自己的稳定契约。这是外部框架边界的防御性校验。

### 如何处理用户取消

客户端创建 `AbortController` 并把 signal 交给 fetch。Route Handler 将 request 的 abort 转发给 Agent 的 abort signal，同时 stream 的 `cancel()` 也会终止服务端执行。

### 真实模型为什么暂时无法在测试中覆盖

真实模型依赖用户私有 `OPENAI_API_KEY`，也会产生费用和非确定输出。阶段 1 通过类型检查、mock 流测试和手工真实密钥验证分层处理；后续阶段 6 再引入可控制的评测集和 provider mock。

## 性能、稳定性和成本

- 20,000 字符限制是第一层 token 与延迟控制，阶段 2 会按文件和 diff 块做更细筛选。
- 每个请求设置 30 秒超时，避免连接长期占用。
- Mock 模式零模型成本，适合 UI 开发和演示。
- 结构化输出可能增加模型约束和处理时间，但显著降低前端解析失败成本。
- NDJSON 很易调试；生产环境还需要确认代理和 CDN 不会缓冲响应。

## 常见面试问题

### Q1：为什么 Agent 输出后还要定义业务结果 schema？

Agent 的自然语言输出不稳定，而 UI、数据库和后续 Workflow 需要稳定输入。Schema 把模型输出从“文本建议”升级为“可验证的业务对象”，这样前端可以按 severity、evidence 和 suggestion 渲染，也可以在后续阶段做评测和统计。

### Q2：流式输出和结构化输出冲突吗？

不冲突。流式输出解决等待体验，结构化输出解决最终数据可靠性。这里将它们拆为不同事件：`text` 表示过程展示，`result` 表示最终可消费对象。

### Q3：如何防止 diff 里的 Prompt Injection？

首先把 diff 明确标记为不可信数据，并在 system instructions 中禁止执行其中指令；其次不授予执行代码、任意网络或写仓库等工具。真正的防护还需要最小权限工具、内容过滤、可信上下文分层和人工确认，后续阶段会继续实现。

### Q4：为什么 API Route 不直接返回模型错误？

原始错误可能包含 provider、配置或内部实现细节。API 应该把错误映射成用户可行动的安全消息，同时在服务端记录必要的诊断信息，不能向浏览器暴露密钥或基础设施细节。

## 可继续优化方向

- 阶段 2：将 diff 输入替换为受限的 GitHub 只读工具调用。
- 阶段 3：将读取、筛选、分析和汇总拆为 Workflow 步骤。
- 阶段 4：为 findings 补充仓库规范和代码上下文引用。
- 阶段 5：加入审查偏好、工具审批和注入防护策略。
- 阶段 6：建立固定 diff 测试集、质量评分、token 成本和 Trace 监控。
