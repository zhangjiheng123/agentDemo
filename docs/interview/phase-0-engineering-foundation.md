# 阶段 0：工程初始化与 Mastra 基线

## 1. 项目背景和业务目标

代码审查通常需要同时理解 Pull Request 元数据、变更文件、代码 diff、仓库规范和历史讨论。我们的目标不是制作一个只会输出自然语言的聊天页面，而是逐步构建一个可以解释证据、区分步骤、控制权限并持续评测的 PR Review Agent。

阶段 0 只解决工程地基问题：

- 建立可运行的 Next.js + TypeScript 应用。
- 注册一个最小 Mastra Agent，明确 Agent 的服务端归属。
- 预留 tools、workflows 和文档目录。
- 提供环境变量模板、健康检查和可重复验证命令。

## 2. 技术方案和架构设计

```text
Browser
  |
  v
Next.js App Router
  |-- app/page.tsx              项目展示首页
  |-- app/api/health/route.ts   服务健康检查
  |
  v
src/mastra/index.ts
  |
  v
@mastra/core
  |
  v
prReviewAgent
```

模型密钥只通过服务端环境变量读取。当前健康检查只返回配置的模型标识和 Agent 注册名，不执行模型调用，也不返回任何密钥内容。

## 3. 核心概念

### Agent

Agent 是带有指令、模型和可选工具的运行单元。它负责根据输入决定如何生成响应或调用工具。阶段 0 只注册 Agent，不执行复杂审查。

### Mastra 实例

`Mastra` 是应用级注册容器。它把 Agent、Workflow、Tool、Storage、Vector Store 等能力组织起来，便于后续通过统一入口访问。

### Tool

Tool 是 Agent 可以调用的确定性能力，例如读取 GitHub PR。工具应该有明确的输入 schema、错误边界和权限范围，而不是让模型直接访问任意网络资源。

### Workflow

Workflow 是有明确步骤和数据流的任务编排。PR Review 后续会把“拉取 PR、筛选文件、分析代码、汇总结果”拆开。Agent 负责推理，Workflow 负责流程控制。

## 4. 关键代码实现思路

### Agent 定义

文件：`src/mastra/agents/pr-review-agent.ts`

Agent 的 instructions 先固定职责边界：审查要基于证据，信息不足时明确说明，不能凭空捏造。模型通过 `OPENAI_MODEL` 配置，缺省值只用于本地开发配置展示。

### Mastra 注册

文件：`src/mastra/index.ts`

使用 `new Mastra({ agents: { prReviewAgent } })` 创建应用级实例。后续新增 Workflow 或 Tool 时，可以在这个边界集中注册，而不是让页面组件直接创建 Agent。

### 健康检查

文件：`app/api/health/route.ts`

通过 `mastra.getAgents()` 检查注册结果，健康接口不依赖模型调用，所以没有 API Key 也能验证工程是否启动成功。

## 5. 为什么选择当前方案

- **Next.js App Router**：与前端背景衔接自然，页面和服务端 API Route 可以放在同一个项目中。
- **TypeScript**：让 Agent 输入输出、工具参数和 Workflow 状态可以逐步类型化。
- **Mastra 注册容器**：为 Agent、工具和 Workflow 提供清晰边界，方便从单 Agent 演进到完整应用。
- **普通 CSS**：阶段 0 不引入 UI 框架，减少依赖和抽象，让目录和运行机制更容易观察。
- **字符串模型配置**：先使用 `provider/model` 约定，降低阶段 0 的 provider 适配复杂度；阶段 1 再确认具体模型调用和流式 API。

## 6. 其他方案及优缺点

### 直接在 React 组件中调用模型

优点是上手快；缺点是容易泄露密钥、难以控制服务端权限，也不利于后续加入工具和 Workflow。因此只适合非常简单的原型，不适合作为本项目架构。

### 只使用 AI SDK，不使用 Mastra

优点是依赖更少、底层控制更多；缺点是 Agent 注册、Workflow、Memory、评测和可观测性需要自行组织。本项目选择 Mastra，是为了系统学习完整 Agent 工程能力。

### 一开始就搭建完整多 Agent 平台

看起来能力丰富，但会掩盖每个概念的边界，调试和面试讲解成本也更高。我们选择每阶段保持可运行，用真实增量理解架构。

## 7. 问题与解决方式

- **目录名包含大写字母**：`create-next-app` 会拒绝将 `agentDemo` 作为 npm 包名。解决方式是使用临时的小写目录生成骨架，再将文件移入目标目录，并把 package name 设为 `mastra-pr-review-agent`。
- **没有 API Key 也要能验证**：健康接口只检查 Mastra 注册，不触发模型请求，因此阶段 0 可以离线验证。
- **依赖安装 warning**：Mastra 依赖树包含不同 AI SDK 版本的 peer warning。当前不影响编译；后续开始模型调用时，需要锁定兼容版本并把升级纳入单独验证。
- **安全边界**：`.env*` 已加入 Git 忽略规则，只提交 `.env.example`，不提交真实密钥。

## 8. 性能、稳定性、安全和成本

- 阶段 0 没有模型调用，运行成本为零。
- 健康检查是轻量同步接口，不依赖外部 GitHub 或模型服务。
- 模型密钥只在服务端读取，前端页面不引用敏感环境变量。
- 后续工具必须限制仓库和 PR 范围，不能接受任意 URL 或任意 shell 命令。
- 后续流式输出需要处理断开连接、超时、重试和取消，不能只关注正常路径。

## 9. 常见面试问题和参考回答

### Q1：为什么 Agent 不直接放在前端组件里？

因为模型密钥、GitHub Token 和工具权限都属于服务端边界。Agent 放在服务端可以统一处理认证、限流、日志、错误和敏感信息，前端只负责输入、流式展示和用户交互。

### Q2：Mastra 实例和 Agent 是什么关系？

Agent 是具体的推理单元，包含 instructions 和 model；Mastra 是应用级注册容器，负责管理 Agent 以及未来的 Workflow、Storage、Vector Store 等组件。这样页面或 API 不需要自行拼装整个系统。

### Q3：为什么要先做健康检查，而不是直接做聊天页面？

健康检查可以验证应用启动、服务端模块加载和 Agent 注册，而不依赖模型密钥和外部服务。它把“工程是否正常”和“模型调用是否正常”分成两个问题，定位故障更简单。

### Q4：Agent 和 Workflow 应该如何分工？

Agent 适合处理需要模型判断的任务，例如识别潜在 bug 和解释风险；Workflow 适合表达确定的步骤、条件、并行、重试和状态。PR Review 中可以让 Workflow 管流程，让 Agent 管代码分析。

### Q5：阶段 0 为什么不接 GitHub？

因为 GitHub 工具会引入 Token 权限、分页、速率限制、diff 大小和不可信代码内容等问题。先建立稳定基线，再在阶段 2 引入工具，可以让每次故障的范围更小。

## 10. 后续优化方向

- 阶段 1：实现最小审查输入、流式响应和结构化审查 schema。
- 阶段 2：增加只读 GitHub 工具，并限制 owner、repo、pull number 参数。
- 阶段 3：把获取上下文、分析和汇总拆成 Workflow 步骤。
- 阶段 4：把仓库规范和历史 Review 加入检索上下文，并要求引用证据。
- 阶段 5：加入 Memory、工具审批、Prompt Injection 防护和敏感信息过滤。
- 阶段 6：建立固定 PR 测试集、成本统计、Trace、日志和部署方案。

## 11. 启动和验证

```bash
npm install
Copy-Item .env.example .env.local
npm run typecheck
npm run lint
npm run build
npm run dev
```

启动后访问：

- `http://localhost:3000`
- `http://localhost:3000/api/health`

下一阶段依赖：阶段 0 的 Agent 注册、环境变量约定和 Next.js 服务端边界。
