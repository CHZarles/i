# 重建 Pi Agent Core：一次从协议边界开始的工程实践

这不是一次“把 Pi 的文件复制过来”的练习，而是一次重新建立心智模型的过程。

目标工程是 `~/i`，参考实现是 `~/remake-pi/pi`。我熟悉 Python 和 C++，但刚开始学习 TypeScript。真正的困难并不在语法，而在于理解一个 Agent Runtime 为什么要分成类型、Provider、API Adapter、事件流、工具协议和 Agent Loop，以及这些模块分别拥有什么。

截至 2026 年 7 月 14 日，工程已经完成基础类型、认证、Provider 注册、OpenAI Responses 基础适配，以及 Anthropic Messages 请求构造和 SSE 分帧。当前测试共 19 个，全部通过，TypeScript 类型检查也通过。

## 一开始最容易犯的错误：把“能调用模型”当成“理解了 Agent”

最初的直觉很简单：构造请求、调用接口、拿到文本，这样模型不就接上了吗？

但 Pi 的结构并不是围绕一次 HTTP 请求设计的，而是围绕一组长期稳定的边界设计的：

```text
types / event stream
        |
        v
auth
        |
        v
provider + model registry
        |
        v
API adapters
        |
        v
tool protocol
        |
        v
agent loop
        |
        v
stateful Agent / session / harness
```

如果底层协议对象还没有定义清楚，就直接写 Agent Loop，上层代码迟早会知道 OpenAI、Anthropic、MiniMax 的各种细节。这样做也许能跑，但无法形成 Pi 那样可以扩展 Provider、工具和 Session 的结构。

因此，这次实践采用了一个更慢但更可靠的原则：每次只关闭一个拓扑节点，并用一个小测试证明它真的成立。

## 成功经验一：先看运行时对象，再看 TypeScript 类型

TypeScript 初学阶段，一个常见误解是把类型当成会在运行时工作的东西。

例如 Anthropic SDK 提供了：

```ts
MessageCreateParamsStreaming
```

这个类型不会创建请求，也不会保存请求数据。真正存在于运行时的是普通 JavaScript 对象：

```ts
const params = {
  model: "MiniMax-M3",
  messages: [{ role: "user", content: "Hello" }],
  max_tokens: 64,
  stream: true,
};
```

两者的关系是：

```text
MessageCreateParamsStreaming -> 编译期检查 params 的形状
params                       -> 运行时真正保存请求数据
buildParams()                -> 创建 params
SDK client                   -> 把 params 发到网络
```

这个区分一旦明确，`import type`、接口、联合类型和 SDK 类型就不再神秘。它们是约束运行时对象的工具，不是运行时对象本身。

## 成功经验二：Provider 和 API 协议不是同一个概念

这次最重要的架构理解之一，是 MiniMax 与 Anthropic Messages 的关系。

MiniMax 是 Provider，负责：

- Provider ID 和展示名称
- API Key 的来源
- Base URL
- 模型目录
- 选择哪一种 API Adapter

Anthropic Messages 是协议，负责：

- 请求体的字段结构
- `/v1/messages` 的调用方式
- SSE 事件类型
- 文本、工具调用和停止原因的转换

因此 Pi 的真实拓扑是：

```text
minimaxProvider
  id/auth/models/baseUrl
          |
          | api: anthropicMessagesApi()
          v
anthropic-messages.ts
          |
          v
https://api.minimax.io/anthropic/v1/messages
```

这意味着，为了使用 MiniMax，需要实现 Anthropic Messages Adapter，但不需要先实现 Anthropic 公司的 Provider 和模型目录。

这个边界也解释了为什么新增一个兼容 Provider 通常不应该修改 Agent Loop。新的 Provider 只需提供模型、认证、地址和 Adapter 绑定。

## 成功经验三：请求转换必须尊重 Provider 的真实结构

OpenAI Responses 和 Anthropic Messages 都要把 Pi 的内部 `Context` 转成 Provider 请求，但它们的函数形状不同。

Pi 的内部输入是：

```text
Context
|- systemPrompt
`- messages[]
```

OpenAI Responses 把 system prompt 和对话消息都放进同一个 `input` 数组，因此转换函数需要完整的 `context`：

```text
convertResponsesMessages(model, context)
  |- context.systemPrompt -> system/developer item
  `- context.messages     -> user/assistant items
```

Anthropic Messages 把 `system` 与 `messages` 分开，因此职责被拆成两层：

```text
buildParams(model, context)
  |- context.systemPrompt           -> params.system
  `- convertMessages(context.messages) -> params.messages
```

最终形成了两个小而明确的函数：

- `convertMessages()`：只转换消息历史。
- `buildParams()`：构造完整的 Anthropic 请求对象。

对应测试先证明用户消息和 Assistant 文本能够转换，再证明 MiniMax 的模型 ID、system prompt、最大输出 token 和 `stream: true` 能进入正确的请求字段。

## 成功经验四：SSE 必须按层理解

“服务器已经通过 SSE 发数据了，为什么客户端还要处理 SSE？”这是整个过程中最值得追问的问题之一。

服务器发送 SSE，指的是它发送了符合 SSE 格式的字节。`fetch()` 返回的 `Response.body` 仍然是：

```ts
ReadableStream<Uint8Array>
```

网络 chunk 可以在任意位置断开：

```text
chunk 1: "event: message_"
chunk 2: "start\ndata: {\"type\":\"message"
chunk 3: "_start\"}\n\n"
```

所以 Anthropic Adapter 需要完成多层转换：

```text
Response.body bytes
        |
        v
TextDecoder + buffer
        |
        v
complete text lines
        |
        v
SseDecoderState
        |
        | blank line
        v
ServerSentEvent
        |
        | JSON.parse
        v
RawMessageStreamEvent
        |
        v
Pi AssistantMessageEvent
```

这里的两个对象看起来很像，但生命周期不同：

```text
SseDecoderState                  ServerSentEvent
----------------                 ----------------
未完成的帧                       已完成的帧
解码器持有并修改                 交给下一层的稳定快照
data: string[]                   data: string
完成后清空并复用                 返回后保持不变
```

围绕这个边界，我们依次实现并测试了：

1. `decodeSseLine()`：逐行收集 `event:` 和 `data:`。
2. `flushSseEvent()`：空行到达时生成完整帧并重置状态。
3. `consumeLine()`：从文本缓冲区取出完整行。
4. `iterateSseMessages()`：读取任意大小的网络 chunk，并逐个 `yield` 完整 SSE 帧。

测试特意把一个 SSE 行拆到多个二进制 chunk 中。如果这个测试能通过，才说明代码处理的是网络现实，而不是只处理手工拼好的完整字符串。

## OpenAI Adapter 中学到的事件流边界

OpenAI Responses Adapter 的实现进一步说明了最终消息与过程事件不是同一个对象。

```text
output -> 一次模型回复正在形成的最终 AssistantMessage
stream -> 上层可以实时消费的过程事件
```

Provider 的增量事件会同时做两件事：

- 修改 `output.content`，逐步形成最终消息。
- 向 `AssistantMessageEventStream` 推送 `text_start`、`text_delta`、`text_end`、`toolcall_*` 等事件。

工具调用同样是渐进式到达的。Adapter 必须使用 `output_index` 或 content index，把后续 delta 追加到正确的内容块，而不是假设永远只有一个文本输出或一个工具调用。

这部分实现中，一个很有价值的修正是去掉硬编码的 `contentIndex: 0`。正确的 index 必须来自刚刚插入 `output.content` 的位置，否则一旦同时存在文本、reasoning 或 tool call，事件就会指向错误的内容块。

## 失败经验一：过早替学习者写代码

早期协作中，最明显的问题不是技术错误，而是教学边界错误。

有时看到一个简单的 TypeScript 错误，就直接给出或写入修复代码。例如 Provider 测试缺少必填的 `api` 字段，这类问题很容易马上修掉。但用户的目标不是尽快得到一个绿色测试，而是练习自己写代码。

这导致了一个明确规则：

> 默认只检查、解释、给出精确位置和测试；只有用户明确要求编辑时，才直接修改实现。

这个失败说明，工程 mentoring 的成功标准不能只看代码是否正确。还要看学习者是否获得了代码所有权。

## 失败经验二：为了“更清楚”而改坏了参考抽象

Anthropic 消息转换最初被建议命名为：

```ts
convertAnthropicMessages(context)
```

这个名字看起来更明确，但并不忠于 Pi。

Pi 使用的是 `convertMessages(messages, ...)`，而 system prompt 由 `buildParams()` 处理。最初的函数把完整 `Context`、system prompt 和 messages 混在一起，破坏了原本清晰的职责边界。

最后的修正是：

```text
convertMessages(messages) -> MessageParam[]
buildParams(context)       -> MessageCreateParamsStreaming
```

这个失败的价值在于：命名不是表面问题。函数参数往往暴露了模块真正拥有的职责。为了“解释得更清楚”而改变函数边界，可能反而让架构变得不清楚。

## 失败经验三：对“忠于 Pi”的定义摇摆不定

最初 Anthropic Adapter 计划使用本地 `fetch()` 和自定义请求类型。这样做能更直接地学习 HTTP 和 SSE，而且学习路线本身允许用小型 fetch wrapper 证明 Adapter 合约。

但参考 Pi 实际使用：

```text
@anthropic-ai/sdk 0.91.1
openai 6.26.0
```

用户明确要求更忠于 Pi 后，继续坚持本地替代类型就不合适了。最终工程安装了与 Pi 相同版本的 Anthropic SDK，并直接使用：

```ts
MessageParam
MessageCreateParamsStreaming
```

这里得到的经验是：

- “架构忠实”允许替换底层依赖，只要边界和行为一致。
- “依赖忠实”要求使用相同 SDK 和官方类型。
- 开始实现前必须明确当前追求哪一种忠实度，不能在过程中来回切换。

即使使用 SDK，Pi 仍然需要自己写消息转换、请求构造和事件映射。SDK 不认识 Pi 的 `Context`，也不会替 Pi 生成 `AssistantMessageEvent`。

## 失败经验四：测试一度跨过了太多机制

在完成 `decodeSseLine()` 后，下一版测试直接要求实现 `iterateSseMessages()`。但参考实现的网络读取器还依赖换行定位、buffer 消费、TextDecoder 尾部处理、AbortSignal 和 reader lock 释放。

这使一个本应很小的学习步骤突然膨胀。

后来把知识拆成了两个层次：

```text
decodeSseLine()       -> 一行怎样影响一个 SSE 帧
iterateSseMessages()  -> 网络 chunk 怎样变成多行和多个帧
```

这个失败说明，一个测试虽然“聚焦于一个函数”，不一定聚焦于一个机制。判断切片大小时，应看它引入了多少新的运行时对象，而不只是看函数数量。

## 失败经验五：注释并不天然等于理解

SSE 代码一开始加入了很多注释和 ASCII 图，但有些图仍然抽象，反而增加阅读负担。真正帮助理解的不是更多文字，而是一个具体执行轨迹：

```text
第 1 次调用：收到 event 行，保存 event，返回 null
第 2 次调用：收到 data 行，保存 data，返回 null
第 3 次调用：收到空行，返回完整帧并清空 state
```

随后又加入了一个连续事件测试，让 `message_start` 和 `content_block_delta` 真正走过状态机。相比描述“这是一个 SSE decoder”，观察对象在每次调用后的变化更容易建立直觉。

这条经验可以概括为：

> 注释解释意图，测试展示使用场景，执行轨迹建立理解。三者不能互相替代。

## 提交策略：让 Git 历史反映学习拓扑

这次实践没有把 Anthropic Adapter 一次性提交，而是按机制拆成了连续提交：

```text
93e4d8a build anthropic messages request parameters
60333a4 decode anthropic sse frames
7325e31 read anthropic sse byte stream
```

这样的 Git 历史有两个好处：

1. 回看 diff 时，每次只需要理解一个所有权边界。
2. 如果后续流解析失败，可以快速定位是请求构造、SSE 分帧还是网络读取的问题。

OpenAI Adapter 也采用了相同策略：消息转换、wrapper、文本流、错误事件、文本进度、工具调用和停止原因分别提交。提交不仅是版本管理工具，也可以成为学习地图。

## 当前进度与下一步

当前 Anthropic Messages Adapter 已经完成：

- Pi `Message[]` 到 SDK `MessageParam[]` 的基础文本转换。
- system prompt、模型、max tokens 和 stream 参数构造。
- SSE 单行解析和帧状态管理。
- 任意网络 chunk 到完整 SSE frame 的增量读取。

当前尚未完成的是下一层：

```text
ServerSentEvent
        |
        | 检查 event 名称 + JSON.parse(data)
        v
RawMessageStreamEvent
        |
        v
处理 message_start / content_block_delta / message_stop
```

下一步应实现 `iterateAnthropicEvents()`，过滤非 Anthropic 消息事件、处理 `error` 帧、解析 `data` JSON，并保证一个以 `message_start` 开始的流必须以 `message_stop` 结束。随后才进入文本 block、工具调用、usage 和 stop reason 到 Pi 事件协议的转换。

## 最终总结

这次实践最重要的成果不是已经写出的代码，而是逐渐稳定下来的判断方式：

1. 先画运行时对象之间的关系，再写类型。
2. 先确定谁拥有机制，再决定函数放在哪里。
3. 测试要证明一个行为边界，而不是堆砌断言。
4. SDK 负责网络和官方类型，Adapter 负责 Pi 与 Provider 协议之间的翻译。
5. SSE、Provider event 和 Pi event 是三个不同层次，不能混成一个“流”。
6. 失败的指导、错误的命名和过大的测试切片，都应该被记录，因为它们暴露了真正难理解的边界。

重建 Pi Agent Core 的价值，正是在这些边界上。只有能够解释一个对象由谁创建、由谁修改、何时结束、交给谁消费，才算真正拥有这段代码。
