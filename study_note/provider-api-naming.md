# OpenAI Responses 与 Anthropic Messages 命名

运行时对象

i 持有一个provider中立的对话对象：

Context
|- systemPrompt
`- messages[]

每个 API 适配器都将这个内部对象转换为对应提供商的传输格式。

i Context
|- OpenAI Responses 适配器 -> POST /v1/responses
`- Anthropic Messages 适配器 -> POST /v1/messages

## 为什么 OpenAI 接收 context

OpenAI Responses API 将系统提示和对话消息放在同一个 input 数组中。
因此 convertResponsesMessages(model, context) 需要完整的 Context：

context.systemPrompt -> system/developer 输入项
context.messages -> user/assistant 输入项

## 为什么 Anthropic 接收 messages

Anthropic Messages API 将 system 与 messages 分开。
buildParams(model, context, ...) 负责这一拆分：

context.systemPrompt -> params.system
convertMessages(context.messages) -> params.messages

因此 Anthropic 的 convertMessages() 只转换 Message[]；它既不负责系统提示，也不负责完整的请求体。

## 为什么叫 "Responses" 和 "Messages"

Responses 和 Messages 是官方的 API 产品名称，而不是对 HTTP 方向的描述：

OpenAI Responses API POST /v1/responses
Anthropic Messages API POST /v1/messages

convertResponsesMessages() 用于 OpenAI Responses API 的消息转换，尽管其结果被用于一次 HTTP 请求中。

### 请求类型命名

remake-pi/pi 使用了 Anthropic SDK 的类型 MessageParam。
当前 i 也安装了同版本 SDK，因此直接使用 MessageParam，不再定义本地替代类型。

convertResponsesMessages(context) -> ResponsesInputItem[]
convertMessages(messages) -> MessageParam[]

名称不同是因为两个提供商的协议在请求体的结构上有所差异。
但架构职责是相同的：将 i 内部消息转换为某个提供商的协议。

参考文件

- ~/remake-pi/pi/packages/ai/src/api/openai-responses-shared.ts
- ~/remake-pi/pi/packages/ai/src/api/anthropic-messages.ts
- ~/remake-pi/pi/packages/ai/src/providers/minimax.ts
- ~/remake-pi/pi/packages/ai/src/providers/anthropic.ts
