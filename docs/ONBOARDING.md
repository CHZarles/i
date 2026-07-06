# 项目 Onboarding 指南

> 基于 `.understand-anything/knowledge-graph.json` 自动生成,同步自 commit `24516d4`。
>
> 当前图谱状态:**47 节点 / 88 边 / 7 分层 / 7 步导览**(`analyzedFiles: 23`)。
>
> 文档由 `/understand-anything:understand-onboard` skill 生成(2026-07-05)。

---

## 1. 项目总览

**项目名**: `i`

**主语言**: TypeScript(ESM)、JSON、Markdown

**框架**: 无(transport 与 SSE 解析均为手写,符合 KISS)

**一句话定位**: 轻量 TypeScript ESM monorepo,核心包 `packages/ai` 提供 AI provider 注册与转发,支持 OpenAI Responses API、Anthropic Messages API 与 MiniMax(MiniMax-M)provider,带 SSE 事件流解析与统一鉴权抽象。

**包结构**: 单包 monorepo。根 `package.json` 仅声明 `dotenv` 与 `@types/node`(`type: "module"`),业务实现集中在 `packages/ai/`。

---

## 2. 架构分层

整个仓库从下到上分成 7 层,新成员建议**自底向上**阅读:

| # | 分层 | 职责 | 关键文件 |
|---|---|---|---|
| 1 | **类型定义层** | provider 公共契约;SSE 队列泛型 | `src/types.ts`、`src/utils/event-stream.ts` |
| 2 | **API 与传输层** | 与上游 LLM 通信的 transport | `src/api/openai-responses.ts`、`src/api/openai-responses.lazy.ts`、`src/api/anthropic-messages.ts` |
| 3 | **鉴权抽象层** | 统一鉴权接口与 helpers | `src/auth/types.ts`、`src/auth/helpers.ts` |
| 4 | **Provider 注册层** | provider 工厂与注册中心 | `src/models.ts`、`src/providers/openai.ts`、`src/providers/openai.models.ts`、`src/providers/minimax.ts`、`src/providers/minimax.models.ts` |
| 5 | **测试层** | smoke + e2e 双层验证 | `test/test_*.ts`(6 个文件) |
| 6 | **工作区配置** | monorepo 根 manifest、env、工具配置 | `package.json`、`.env`、`.understand-anything/config.json` |
| 7 | **AI 客户端规则** | Codeium 与 understand-anything 的忽略规则 | `.codeiumignore`、`.understand-anything/.understandignore` |

---

## 3. 关键概念与设计决策

- **ESM-only monorepo**:`package.json` 中 `"type": "module"`,所有源码用 `import`/`export`,不混用 CommonJS。
- **Provider 工厂模式**:`createProvider(options)` 把「模型列表 + auth + stream 实现」三段拼成统一 `Provider` 实例;`openaiProvider` / `minimaxProvider` 都是此工厂的具体封装。
- **统一鉴权抽象**:`ModelAuth` 描述单次请求的鉴权字段;`ApiKeyAuth` / `ProviderAuth` 描述 provider 级别的持久化与解析流程;`AuthContext.env(name)` 抽象出 env 访问入口,避免每个 provider 直接 `process.env`。
- **`envApiKeyAuth` 工厂**:封装「stored credential → env 变量回退」的解析流程,被 OpenAI 与 MiniMax provider 复用,避免重复造轮子。
- **SSE 事件流**:`EventStream<T>` 是泛型异步队列,`AssistantMessageEventStream` 是其特化;transport 沿 `start → done/error` 顺序向其推事件,消费端用 `async iterator` 异步消费。
- **`satisfies` 类型锚定**:`OPENAI_MODELS` 用 `satisfies Model<"openai-responses">`、`MINIMAX_MODELS` 用 `satisfies Model<"anthropic-messages">`,既保留字面量类型推断,又强制约束 API 契约。
- **惰性包装层**:`api/openai-responses.lazy.ts` 暴露 `openAIResponsesApi`,避免在不需要时引入 fetch 与 SSE 解析。
- **复用 Anthropic Messages 兼容协议**:MiniMax 直接走 `callAnthropicMessages`(Anthropic Messages API 兼容),不是另写一套协议;新增模型只要在 `minimax.models.ts` 加一行。

---

## 4. 文件地图(按分层)

### 4.1 类型定义层
- **`packages/ai/src/types.ts`**(106 行,moderate):核心类型中枢,定义 `Model`、`Message`、`Usage`、`Context`、`AssistantMessageEventStream`、`ProviderStreams`、`StreamFunction`。所有 provider、transport、test 都引用此文件(fan-in 最高)。
- **`packages/ai/src/utils/event-stream.ts`**(83 行,moderate):通用 SSE 事件流解析器,导出 `EventStream` 泛型 `AsyncIterable` 与 `AssistantMessageEventStream` 特化。

### 4.2 API 与传输层
- **`packages/ai/src/api/openai-responses.ts`**(134 行,moderate):OpenAI Responses API 的流式适配,`streamSimple` 是 `StreamFunction` 主入口。
- **`packages/ai/src/api/openai-responses.lazy.ts`**(4 行,simple):惰性包装,导出 `openAIResponsesApi`。
- **`packages/ai/src/api/anthropic-messages.ts`**(47 行,moderate):Anthropic Messages API 的非流式 POST 调用,导出 `callAnthropicMessages`。

### 4.3 鉴权抽象层
- **`packages/ai/src/auth/types.ts`**(83 行,moderate):9 个接口契约——`ModelAuth`、`ApiKeyCredential`、`AuthContext`、`AuthResult`、`AuthPrompt`、`AuthLoginCallbacks`、`ApiKeyAuth`、`ProviderAuth`、`Auth`。
- **`packages/ai/src/auth/helpers.ts`**(35 行,simple):导出 `envApiKeyAuth(promptName, envNames)`。

### 4.4 Provider 注册层
- **`packages/ai/src/models.ts`**(70 行,moderate):定义 `Provider` 与 `CreateProviderOptions`,导出 `createProvider({...})` 工厂。
- **`packages/ai/src/providers/openai.models.ts`**(15 行,simple):`OPENAI_MODELS`,`satisfies Model<"openai-responses">`。
- **`packages/ai/src/providers/openai.ts`**(17 行,simple):`openaiProvider()`,绑定 `OPENAI_API_KEY`。
- **`packages/ai/src/providers/minimax.models.ts`**(15 行,simple):`MINIMAX_MODELS`,`satisfies Model<"anthropic-messages">`,1M 上下文 / 128K 输出。
- **`packages/ai/src/providers/minimax.ts`**(15 行,simple):`minimaxProvider()`,baseUrl 指向 `api.minimax.io/anthropic`。

### 4.5 测试层(全部 simple/moderate,失败 exit 1)
- `test_auth.ts` — smoke:`envApiKeyAuth` 解析
- `test_models.ts` — smoke:`createProvider` 装配
- `test_openai_provider.ts` — smoke:`openaiProvider` 实例化
- `test_openai_provider_stream.ts`(40 行,moderate)— e2e:真实 OpenAI Responses API 流式
- `test_minimax_provider.ts` — smoke:`minimaxProvider` 实例化
- `test_minimax_raw_provider.ts` — 调 `callAnthropicMessages` 验证 raw transport

### 4.6 工作区配置
- `package.json` — ESM workspace 根,仅 `dotenv` 运行时依赖
- `.env` — OpenAI 与 MiniMax 的 key/baseUrl/Node 代理
- `.understand-anything/config.json` — 工具自动更新与输出语言(`zh`)

### 4.7 AI 客户端规则
- `.codeiumignore` — Codeium 索引/补全忽略规则
- `.understand-anything/.understandignore` — 工具自身的扫描忽略规则

---

## 5. 引导式导览(7 步)

| # | 主题 | 关键节点 |
|---|---|---|
| 2 | 工作区根 manifest 与运行时配置 | `package.json`、`.env` |
| 3 | 类型契约底层:provider 公共类型与 SSE 流 | `src/types.ts`、`src/utils/event-stream.ts` |
| 4 | 鉴权抽象与 env 工厂 | `src/auth/types.ts`、`src/auth/helpers.ts` |
| 5 | Provider 注册中心:`createProvider` 装配 | `src/models.ts` |
| 6 | OpenAI provider:Responses API 流式实现 | `providers/openai.ts`、`providers/openai.models.ts`、`api/openai-responses.ts`、`api/openai-responses.lazy.ts` |
| 7 | MiniMax provider 与 Anthropic Messages 复用 | `providers/minimax.ts`、`providers/minimax.models.ts`、`api/anthropic-messages.ts` |
| 8 | 测试与回归:smoke + e2e 双层校验 | 6 个 `test_*.ts` 文件 |

---

## 6. 复杂度热点(谨慎涉足)

按文件级 `complexity` 降序(`moderate` 优先于 `simple`):

| 文件 | 行数 | 复杂度 | 进入前先读 |
|---|---|---|---|
| `packages/ai/src/api/openai-responses.ts` | 134 | moderate | `src/types.ts`、`src/utils/event-stream.ts` |
| `packages/ai/src/types.ts` | 106 | moderate | 全 repo 公共契约,改动必影响所有 provider |
| `packages/ai/src/auth/types.ts` | 83 | moderate | 9 个接口,任何字段调整都要联动 `auth/helpers.ts` 与两个 provider |
| `packages/ai/src/utils/event-stream.ts` | 83 | moderate | SSE 队列泛型,改特化类签名需同时改 transport 推事件顺序 |
| `packages/ai/src/models.ts` | 70 | moderate | `Provider` / `CreateProviderOptions` 是装配入口,改完要回归测试 6 个 `test_*.ts` |
| `packages/ai/src/api/anthropic-messages.ts` | 47 | moderate | Anthropic Messages API 兼容,`minimax.ts` 依赖,谨慎改响应字段映射 |
| `packages/ai/test/test_openai_provider_stream.ts` | 40 | moderate | 唯一真实端到端流式测试,改动需 `.env` 中具备有效 `OPENAI_API_KEY` |

`simple` 层级文件大多是常量声明或单层桥接,可放心修改。

---

## 7. 入门路径建议

1. 读 **Step 2**(workspace config) → 理解 `.env` 与 `package.json` 的 KISS 用意。
2. 读 **Step 3**(类型契约) → 把 `types.ts` 与 `event-stream.ts` 当作"协议字典"记住。
3. 读 **Step 4**(鉴权抽象) → `envApiKeyAuth` 工厂和 `ApiKeyAuth` 接口是后续所有 provider 都会复用的样板。
4. 跑 `test/test_models.ts` → 看 `createProvider` 装配出来的 provider 长什么样。
5. 跑 `test/test_openai_provider_stream.ts` → 看真实 OpenAI Responses API 流式输出。
6. 对比 OpenAI 与 MiniMax 的 provider 实现 → 发现"MiniMax 复用 Anthropic Messages"这一复用模式(Step 7)。

---

## 8. 维护说明

- 本文档与 `.understand-anything/knowledge-graph.json` 同源,任何代码结构调整后,请重新运行 `/understand-anything:understand` 同步图谱,然后再运行 `/understand-anything:understand-onboard` 重新生成本文档。
- 项目工程规范见 `draft.md`(本地已删除,但仍在提交历史中:`git checkout 24516d4 -- draft.md` 可恢复)。
