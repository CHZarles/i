import type { ProviderStreams } from "../types.ts";
// 把 openai-responses.ts 这个模块整体导入成一个对象。
//
// 如果 openai-responses.ts 里导出了：
//   export const streamSimple = ...
//   export const stream = ...
//
// 那么 openAIResponses 大致就是：
// {
//   streamSimple,
//   stream
// }
import * as openAIResponses from "./openai-responses.ts";

// 返回 OpenAI Responses API adapter。
//
// 返回值类型 ProviderStreams 表示：
// 这个对象必须提供 stream() 和 streamSimple()。
//
// providers/openai.ts 会把它传给 createProvider：
//   api: openAIResponsesApi()
//
// 注意：当前实现不是严格意义的 lazy，
// 因为上面的 import * 已经立即导入了 openai-responses.ts。
// 这里主要是把模块包装成 ProviderStreams 入口。

export const openAIResponsesApi = (): ProviderStreams => openAIResponses;
