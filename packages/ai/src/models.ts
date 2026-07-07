import type { ProviderAuth } from "./auth/types.ts";

import type {
  Api,
  ApiStreamOptions,
  AssistantMessageEventStream,
  Context,
  Model,
  ProviderHeaders,
  ProviderStreams,
  SimpleStreamOptions,
} from "./types.ts";

// 一个已经装配好的 provider 实例。
// Provider 把三类东西合到一起：
// 1. provider 元信息：id、name、baseUrl、headers
// 2. provider 鉴权：auth
// 3. 模型与调用能力：getModels、stream、streamSimple
//
// TApi 表示这个 provider 支持的 API 协议类型。
// 例如 OpenAI provider 可以是 Provider<"openai-responses">。
export interface Provider<TApi extends Api = Api> {
  // provider 的唯一标识。 "openai"、"minimax"。
  readonly id: string;

  // 展示名称。
  // 如果创建时没传 name，createProvider() 会默认使用 id。
  readonly name: string;

  // provider 默认 base URL。
  // 可选，因为有些 provider/model 可能自己带 baseUrl。
  readonly baseUrl?: string;

  // provider 默认 headers。
  // 可选；可被请求级 headers/auth headers 合并或覆盖。
  readonly headers?: ProviderHeaders;

  // provider 的鉴权入口。
  // 例如 apiKey auth、ambient auth、keyless local auth 等。
  readonly auth: ProviderAuth;

  // 返回当前 provider 已知的模型列表。
  //
  // readonly Model<TApi>[] 表示：
  // - 返回的是模型数组
  // - 调用方不应该修改这个数组
  // - 每个模型的 api 必须属于 TApi
  //
  // 例如 Provider<"openai-responses"> 的 getModels()
  // 返回 Model<"openai-responses">[]。
  getModels(): readonly Model<TApi>[];

  // 完整 stream 调用入口。
  //
  // 语法：
  // - <T extends TApi> 是方法自己的泛型
  // - 表示传入的 model.api 可以是 TApi 里的某一个具体 API
  //
  // 参数：
  // - model：要调用的模型
  // - context：对话上下文
  // - options：这个 API 对应的 stream options
  //
  // 返回：
  // - AssistantMessageEventStream，也就是 assistant 回复事件流。
  stream<T extends TApi>(
    model: Model<T>,
    context: Context,
    options?: ApiStreamOptions<T>,
  ): AssistantMessageEventStream;

  // 简化 stream 调用入口。
  //
  // 当前 SimpleStreamOptions 很薄，只包含通用字段；
  // 语义上表示“最小能力调用”。
  streamSimple(
    model: Model<TApi>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream;
}

export interface CreateProviderOptions<TApi extends Api = Api> {
  id: string;
  /** Display name. Default: `id`. */
  name?: string;
  baseUrl?: string;
  headers?: ProviderHeaders;
  /** Required — every provider has auth semantics, even ambient/keyless ones. */
  auth: ProviderAuth;
  /** Initial model list (empty for purely dynamic providers). */
  models: readonly Model<TApi>[];
  api: ProviderStreams;
}

export function createProvider<TApi extends Api = Api>(
  input: CreateProviderOptions<TApi>,
): Provider<TApi> {
  return {
    id: input.id,
    name: input.name ?? input.id,
    baseUrl: input.baseUrl,
    headers: input.headers,
    auth: input.auth,
    getModels: () => input.models,
    stream: (model, context, options) =>
      input.api.stream(model, context, options),
    streamSimple: (model, context, options) =>
      input.api.streamSimple(model, context, options),
  };
}
