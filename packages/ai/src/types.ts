// API 协议/适配器形态：决定请求和响应如何组织
export type KnownApi = "openai-responses" | "anthropic-messages";
// 开放性枚举,  类型层面允许外部扩展 API 协议名，但运行时必须有对应 adapter/stream 实现。
export type Api = KnownApi | (string & {});
// provider 管理 Provider 自动需要的环境变量
//    存储 不属于 apiKey / headers / baseUrl 的配置
//    给非标准 provider 留扩展口
export type ProviderEnv = Record<string, string>;
// Provider/request 级 HTTP header 配置。
// string 表示设置该 header，null 通常用于 header 合并时显式删除/禁用。
//
//  {
//    "x-api-key": "abc",
//    "anthropic-version": "2023-06-01",
//    "authorization": null
//  }
export type ProviderHeaders = Record<string, string | null>;
// 具体的大模型厂家, 网关
export type KnownProvider = "openai" | "minimax";
// 开放枚举：内置 provider 有提示，同时允许外部注册自定义 provider id。
// 注意 endpoint/baseUrl 是另一个概念，不由 ProviderId 表达。
export type ProviderId = KnownProvider | (string & {});

//  一个可调用的大模型配置。
//  TApi 用来把 Model 绑定到某一种 API 协议上。
export interface Model<TApi extends Api = Api> {
  // 模型真实 id，通常用于请求体里的 model 字段。
  // 例如 "gpt-4.1"、"claude-3-5-sonnet-latest"。
  id: string;

  // 展示名称，给 UI 或日志看。
  // 可以比 id 更友好。
  name: string;

  // 该模型使用的 API 协议形态。
  // 比如 "openai-responses" 表示走 OpenAI Responses API adapter。
  // 泛型 TApi 可以把某个 provider/stream 函数限制在特定 API 类型上。
  api: TApi;

  // provider 标识，表示模型属于哪个 provider。
  // 例如 "openai"、"minimax"，也可以是自定义 provider id。
  provider: ProviderId;

  // 请求基础地址。
  // 例如 "https://api.openai.com/v1"。
  // 具体 endpoint 通常由 api adapter 拼接。
  baseUrl: string;

  // 是否支持 reasoning/思考能力。
  // 这是模型能力标记，不代表每次请求都一定开启 reasoning。
  reasoning: boolean;

  // 支持的输入类型。
  // text 表示文本输入，image 表示图像输入。
  input: ("text" | "image")[];

  // 上下文窗口大小，通常表示模型最多能处理多少 token。
  contextWindow: number;

  // 单次输出的最大 token 数。
  maxTokens: number;
}

// 统一从 types.ts 暴露流类型，隐藏 utils/event-stream.ts 的具体位置。
export type { AssistantMessageEventStream } from "./utils/event-stream.ts";

// 本文件内部用它标注 stream 返回值；type-only import 不产生运行时代码。
import type { AssistantMessageEventStream } from "./utils/event-stream.ts";

// 单次模型流调用的通用请求选项。
export interface StreamOptions {
  // API key 可选：可能由 auth/env 注入，或 provider 不使用 apiKey。
  apiKey?: string;

  // 本次请求最大输出 token；不传则用模型或 provider 默认值。
  maxTokens?: number;
}

export interface SimpleStreamOptions extends StreamOptions {}

// TextContent 表示消息里的一段文本内容
export interface TextContent {
  type: "text";
  text: string;
}

export interface Usage {
  // 输入 token 数，比如用户 prompt、上下文消息。
  input: number;
  // 输出 token 数，比如 assistant 生成的回复。
  output: number;
  // 从缓存读取的 token 数
  cacheRead: number;
  // 写入缓存的 token 数
  cacheWrite: number;
  // 总 token 数。通常是 input + output，也可能直接用 provider 返回的 total。
  totalTokens: number;
  // 费用统计，结构和 token 用量对应。
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export type StopReason = "stop" | "error";

// UserMessage , AssistantMessage, Message , Context, 构成"对话历史”的核心数据结构

//  用户发出的消息
export interface UserMessage {
  // 角色标签。固定为 "user"，用于区分消息来源。
  role: "user";

  // 用户输入内容。
  // 当前简化版只支持纯字符串。
  // pi 的成熟实现里这里是 string | (TextContent | ImageContent)[]，
  // 方便支持多模态输入。
  content: string;

  // 消息创建时间，通常是 Date.now()，单位是毫秒。
  timestamp: number;
}

// 模型返回的 assistant 消息。
export interface AssistantMessage {
  // 角色标签。固定为 "assistant"。
  role: "assistant";

  // assistant 输出内容。
  // 用数组是为了以后支持多段文本、thinking、toolCall 等内容块。
  // 当前项目里只有 TextContent[]。
  content: (TextContent | ToolCall)[];

  // 这条回复是通过哪种 API 协议产生的。
  // 例如 "openai-responses"。
  api: Api;

  // 这条回复来自哪个 provider。
  // 例如 "openai"、"minimax"。
  provider: ProviderId;

  // 实际请求的模型 id。
  // 例如 "gpt-4.1"。
  model: string;

  // 本次调用的 token 和费用统计。
  usage: Usage;

  // 停止原因。
  // 当前只有 "stop" | "error"。
  stopReason: StopReason;

  // 错误信息。只有 stopReason 为 "error" 时通常才有。
  errorMessage?: string;

  // 消息创建时间，单位毫秒。
  timestamp: number;

  // provider 返回的响应 id。
  // 例如 OpenAI response id，用于追踪、续聊或日志定位。
  responseId?: string;
}

// 对话中的一条消息。
// 通过 role 字段可以区分具体是哪种。
export type Message = UserMessage | AssistantMessage;

// 调用模型时传入的上下文。
// 本质就是当前对话历史。
export interface Context {
  systemPrompt?: string;
  messages: Message[];
}

export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// 这是 assistant 流式调用的事件协议
// 可辨识联合类型：每个事件都有 type，调用方用 event.type 区分形态。
//
// start/done/error 是整条 assistant 回复的生命周期事件。
// text_start/text_delta 是回复生成过程中的局部进度事件，
// 用来让 UI/terminal 在最终 done 之前先显示增量文本。
export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "done"; reason: "stop"; message: AssistantMessage }
  | { type: "error"; reason: "error"; error: AssistantMessage }
  // 一个新的文本 content block 开始了。contentIndex 指向 partial.content。
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | {
      // 一段新文本到达了；delta 是本次新增片段，不是完整文本。
      type: "text_delta";
      contentIndex: number;
      delta: string;
      partial: AssistantMessage;
    }
  | {
      // 文本 block 已经结束；content 是这个 block 的最终完整文本。
      type: "text_end";
      contentIndex: number;
      content: string;
      partial: AssistantMessage;
    };

// 先去看 event-stream.ts 再回来看下面的👇

// 一个 provider stream 函数的标准形状。
//
// TApi:
//   这个 stream 函数支持哪种 API 协议。
//   例如 "openai-responses"。
//
// TOptions:
//   这个 stream 函数支持哪些请求选项。
//   默认只有通用 StreamOptions。
export type StreamFunction<
  TApi extends Api = Api,
  TOptions extends StreamOptions = StreamOptions,
> = (
  // 要调用的模型。
  // Model<TApi> 会保证 model.api 和这个 stream 函数支持的 API 类型一致。
  model: Model<TApi>,

  // 本次调用的对话上下文。
  context: Context,

  // 本次调用的可选参数，比如 apiKey、maxTokens。
  options?: TOptions,
) => // 返回 assistant 消息事件流。
// 调用方可以 for await 读取过程事件，
// 也可以 await stream.result() 拿最终 AssistantMessage。
AssistantMessageEventStream;

// 定义一个 API adapter / provider stream 模块必须提供哪些方法。
//  StreamFunction 是一个调用函数的形状；
//  ProviderStreams 是 provider 要交出来的一组调用函数。
export interface ProviderStreams {
  // 完整 stream 调用。
  //
  // 输入模型、上下文和请求选项，
  // 返回 assistant 消息事件流。
  stream(
    model: Model<Api>,
    context: Context,
    options?: StreamOptions,
  ): AssistantMessageEventStream;

  // 简化 stream 调用。
  //
  // 当前 SimpleStreamOptions 和 StreamOptions 一样；
  // 但语义上它表示“最小能力调用”。
  //
  // 以后 stream 可以支持更复杂能力，
  // streamSimple 仍然可以保留简单文本调用入口。
  streamSimple(
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream;
}

// 某个 API 协议对应的 stream options 类型。
//
// 当前简化版没有按 API 精确区分 options，
// 所以所有 API 都是：
//   通用 StreamOptions + 任意额外字段。
//
// TApi 现在只是预留参数，暂时没有参与计算。
export type ApiStreamOptions<TApi extends Api> = StreamOptions &
  Record<string, unknown>;
