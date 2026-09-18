# 阶段 4：Prompt 工程与可引用 RAG 上下文

## 项目背景和业务目标

阶段 3 的 Workflow 可以安全拉取 PR patch 和选中文件，但只看 diff 往往无法判断“这段代码是否违反项目约定”。例如一个重定向写法在代码语法上正确，却可能违反团队的 allowlist 安全规则；一个 `response.json()` 调用也需要结合错误处理约定才知道是否有风险。

本阶段的目标是把三个学习主题接进同一条真实业务链路：

- LLM：真实模型在服务端接收结构化 Prompt 并返回 schema 约束结果。
- Prompt 工程：通过 `baseline-v1` 与 `evidence-v2` 版本化对比，而不是凭感觉修改一句话。
- RAG：将项目 Markdown 规则解析、切分、召回、重排后，以可引用上下文注入 PR Review Agent。

最终 Workflow：

```text
验证 PR 输入
  -> 拉取受限 GitHub 上下文
  -> 检索仓库规则和历史 Review
  -> 无文件分支 / Agent 分析分支
  -> 汇总带 Prompt 版本和 RAG citations 的结构化结果
```

## 技术方案与架构

```text
docs/knowledge-base/*.md + README.md
  -> readFile
  -> Markdown heading-aware chunking
  -> local hash embedding / OpenAI embedding
  -> lexical score + cosine vector score
  -> deterministic rerank
  -> top 3 chunks
  -> bounded prompt context

GitHub PR context + user focus + selected prompt policy + retrieved guidance
  -> Mastra prReviewWorkflow
  -> prReviewAgent.generate(structuredOutput)
  -> ReviewResult with evidence and optional sources
```

关键文件：

- `src/domain/rag/index.ts`：文档、chunk、citation schema；切分；本地 hash 向量；混合打分和重排。
- `src/services/rag/retriever.ts`：固定来源读取、OpenAI embedding 调用、缓存和本地降级。
- `src/domain/workflow/index.ts`：Prompt version、RAG 输出契约、Prompt 拼装。
- `src/mastra/workflows/pr-review-workflow.ts`：新增 `retrieve-review-guidance` 步骤。
- `docs/knowledge-base/`：可编辑、可观察的初始规则库。
- `docs/evals/pr-review-cases.md`：八个固定评测案例。

## 核心概念

### Prompt 工程不是“把提示词写长”

Prompt 应该像代码一样有版本、目标和可验证结果。

本项目保留两种策略：

```text
baseline-v1
```

用于建立基线，重点是通用正确性与安全审查。

```text
evidence-v2
```

默认版本，增加三项约束：

- 优先报告正确性、可靠性、安全风险，减少纯风格噪声。
- 每个 finding 的 `sources` 必须包含变更 PR 文件路径。
- 只有检索规则确实支撑结论时，才能引用对应 `GUIDANCE_ID`。

这让 Prompt 改动变成可比较的实验变量。使用 `docs/evals/pr-review-cases.md` 的同一批案例、同一模型和多次运行，才能判断 v2 是否真的降低误报或提高证据质量。

### RAG 的完整最小闭环

RAG 不是“把文档直接塞进 Prompt”，而是：

```text
Document parsing
  -> Chunking
  -> Embedding
  -> Retrieval
  -> Rerank
  -> Context assembly
  -> Grounded generation
  -> Evaluation
```

本项目中：

- parsing：读取固定的 `README.md` 与 `docs/knowledge-base/*.md`。
- chunking：先按 Markdown heading 分段，再按约 900 字符切块，保留 140 字符 overlap。
- embedding：默认 192 维 local hash vector；可选 OpenAI embedding。
- retrieval：关键词 overlap 与 cosine similarity 混合。
- rerank：对 title、path、heading 中出现 query token 的 chunk 增加透明 boost。
- context assembly：最多 3 块、最多 12,000 字符，防止 RAG 反而撑爆 Prompt。
- grounded generation：Prompt 要求 finding 的 `sources` 引用 PR path 和真实 `GUIDANCE_ID`。
- evaluation：固定八个案例验证“该召回什么”和“不该编造什么”。

### 为什么默认 local hash vector

默认本地向量会把 token 映射到确定性 192 维向量，再进行 cosine similarity。它的优点是：

- 无 API Key、无成本、无网络，团队成员克隆项目后即可运行。
- 相同输入总是产生同样向量，适合测试 chunk、ranking 和 UI。
- 能帮助理解 vector、cosine、hybrid rank 的数据流。

它不具备真实语义 embedding 的质量，例如“登录回调”和“authentication redirect”不一定足够接近。因此它是教学和降级方案，不是生产语义检索的最终选择。

设置：

```env
RAG_EMBEDDING_MODE=openai
RAG_EMBEDDING_MODEL=openai/text-embedding-3-small
OPENAI_API_KEY=...
```

后，服务端批量向 OpenAI embeddings API 请求文档 chunk 和 query 向量。请求失败时不会让整个 Review 不可用，而是返回 `local-fallback` 并继续执行。

### Hybrid Retrieval 和 Rerank

仅关键词搜索会漏掉同义表达；仅向量搜索可能召回语义相近但具体规则不准确的片段。因此先计算：

```text
hybrid = 0.55 * lexical_overlap + 0.25 * normalized_cosine
```

再加一个轻量 rerank：

```text
rerank = hybrid + title/path/heading overlap boost + knowledge-base source boost + topic-path metadata boost
```

这里的重排不用模型，原因是第一版应优先可解释、低延迟和零额外模型成本。默认 hash vector 容易发生碰撞，所以其权重低于精确 lexical match；`docs/knowledge-base/` 的规则来源也会获得小幅优先级。检索 query 明确带有 `security`、`error`、`review` 等领域词时，对应的文档 path 还会获得 topic metadata boost，避免项目 README 或无关规则挤掉专门的安全或错误处理文档。UI 显示 path、excerpt、ID 和 score，让开发者可以检查“为什么这条规则被放进 Prompt”。

### Grounding 和引用

检索文档不是系统指令。PR 标题、PR body、diff、文件内容和 RAG 文档都可能含有不可信文本，因此 Prompt 使用：

```text
BEGIN_UNTRUSTED_PULL_REQUEST_CONTEXT
...
END_UNTRUSTED_PULL_REQUEST_CONTEXT

BEGIN_UNTRUSTED_RETRIEVED_GUIDANCE
...
END_UNTRUSTED_RETRIEVED_GUIDANCE
```

Agent 仍不能执行代码、扩大 GitHub 访问、选择任意 URL 或做写操作。引用的作用不是证明模型绝不会幻觉，而是让输出具备可审计入口：reviewer 可以看到 finding 关联的 PR 文件和知识库 chunk。

## 为什么选择当前方案

### 为什么不一开始上向量数据库

当前知识库只有少量 Markdown，持久化向量数据库会增加部署、索引同步、权限隔离和成本复杂度，却掩盖 RAG 的核心链路。先用内存 retrieval 建立正确的切分、召回、引用和评测习惯。

当资料量、多人并发或增量更新增长时，再迁移到 pgvector、Qdrant、Pinecone 或其他向量库。迁移时保持 `RagChunk`、`RagCitation` 和 Workflow 输入输出契约，避免 UI 与 Agent 逻辑被数据库实现绑死。

### 为什么不让 Agent 自己搜索文档

检索的范围、数量和成本是系统控制面，不应由模型自由扩张。Workflow 明确执行 `retrieve-review-guidance`，固定来源、chunk 数和字符预算；Agent 只负责基于已选资料推理。这与阶段 2 的 GitHub Tool 最小权限原则一致。

### 为什么先用确定性 rerank

模型 rerank 往往更灵活，但会带来二次模型调用、延迟、成本和非确定性。初版使用确定性 title/path boost，能让学习重点放在检索质量和评测设计。只有评测显示它是瓶颈，才值得加入 cross-encoder 或 LLM rerank。

## 常见问题与解决方式

### Q1：为什么 RAG 结果可能让 Review 变差

如果 query 太泛、chunk 太大、召回到无关规则，模型会被错误上下文锚定，产生看似合理但不适用的 finding。解决方式不是无限增加文档，而是检查 query、chunk、score、citation 和固定评测案例；必要时降低检索块数、加入 metadata filter 或在 Prompt 中强调“规则仅在与 PR evidence 相关时适用”。

### Q2：为什么还需要 PR diff，不能只查文档

文档定义“什么算问题”，PR patch 提供“问题是否真的发生”。缺少文档，模型不了解项目约定；缺少 diff，模型不能证明具体风险。RAG 的价值是补充判断标准，不能替代变更证据。

### Q3：local hash embedding 和关键词检索有什么区别

关键词检索直接计算 token 重合。local hash embedding 会把 token 映射进固定维度并比较向量夹角，形式上具备 vector retrieval，但仍是词项驱动，语义泛化很弱。真实 embedding 由模型根据语义训练得到向量，因此对同义表达和上下文相关性更好。

### Q4：embedding 失败为什么不直接报错

RAG 是增强能力，不应让一个可选 provider 把核心 PR Review 完全阻断。这里在 OpenAI embedding 失败时降级到本地向量，并通过 `embeddingMode: local-fallback` 向 UI 暴露事实。生产环境还应记录失败率、延迟和 fallback 次数。

### Q5：如何判断 Prompt v2 更好

不能只看一次输出。对固定案例多次运行，至少记录：

- 预期 finding 是否出现。
- 是否产生 unsupported finding。
- evidence 是否真的指向 patch。
- citation 是否真与结论相关。
- 延迟和 token 成本。

阶段 6 会把这些记录自动化为离线评测和 trace 指标。

## 性能、稳定性、安全和成本

- 每份 Markdown 先 heading 分段，再限制 chunk size，避免单个长文档垄断 context。
- 最多选取 3 个 chunk、最多注入 12,000 字符，控制 token 和延迟。
- local-hash 模式无网络、无模型成本，适合开发和 CI。
- OpenAI embedding 使用进程内 exact-text cache，避免同一服务进程内重复 embedding 固定文档。
- embedding 失败会降级为本地检索；GitHub 与 Agent 的原有 timeout/cancel 链路不变。
- 知识源路径固定在代码中，不接收用户 URL、文件系统路径或 Git ref。
- 只返回 citation excerpt 给浏览器，完整检索 chunk 只留在服务端 Prompt 组装。
- 当前使用本地磁盘文档和内存 cache；多实例部署会有重复索引与冷启动，生产需转为构建期/后台 ingestion 和持久向量库。

## 常见面试问题

### Q1：RAG 系统如何避免“检索到了文档，但模型仍然幻觉”？

RAG 只能增加证据，不自动保证 grounded。需要组合措施：限制来源范围和 chunk 数；在 Prompt 中要求 evidence 和 source ID；结构化输出暴露 citations；在评测集中检查 citation 与结论是否相关；对高风险领域可以加入规则校验或人工确认。本项目先实现了前四项。

### Q2：为什么要同时使用关键词和向量检索？

关键词对函数名、错误码、路径、精确术语很可靠；向量对同义表达和自然语言概念更有帮助。两者融合能减少单一方法的盲点。本项目用透明权重完成最小实践，后续可以依据评测数据调参或替换为 BM25 和专业向量库。

### Q3：RAG 的 chunk 如何设计？

chunk 不应只按固定 token 数硬切。这里先尊重 Markdown heading，使一个规则小节尽量完整；超长小节再按字符上限切分，并通过 overlap 保留边界语义。chunk size、overlap、topK 和 context budget 都应通过检索评测调整，而不是固定不变。

### Q4：Prompt Injection 在 RAG 中有什么新风险？

RAG 文档本身也可能被恶意或错误地修改，所以不能把检索内容当 system prompt。项目将所有 retrieved guidance 包在 untrusted delimiter 中，禁止其调用工具或修改权限。真正生产环境还应增加文档写入权限、签名/版本审核和来源信任等级。

### Q5：什么时候应该从本地索引升级到向量数据库？

当文档量使启动时读取和内存排序变慢，或需要多租户隔离、增量更新、跨实例共享、metadata filter、审计和高并发时。升级前先保留稳定的数据契约和评测集，避免只是“换数据库”却不知道检索质量是否改善。

## 可继续优化方向

- 建立仓库级 ingestion：从受控 GitHub 路径读取 README、贡献指南和规范，并按 commit SHA 版本化索引。
- 用真实 embedding、BM25、metadata filter 和 cross-encoder rerank 对比固定评测结果。
- 为 finding 增加精确的 file/line citation，并验证引用是否在实际 PR patch 中出现。
- 增加 retriever trace：query、topK、score、fallback、耗时和 token use。
- 在阶段 6 将八个案例扩展为带 gold findings 的自动评测集，计算 retrieval recall、finding precision、groundedness、成本和延迟。
