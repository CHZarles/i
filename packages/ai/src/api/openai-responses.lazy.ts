import type { ProviderStreams } from "../types.ts";

import * as openAIResponses from "./openai-responses.ts";

/* 
  语法解析
  1. export const openAIResponsesApi —— 导出一个常量 openAIResponsesApi                                                         
  2. = () —— 赋值一个无参数的箭头函数 ,  : ProviderStreams —— 函数的返回类型标注
  3. => openAIResponses —— 函数体只有一行表达式，返回 openAIResponses 这个值
*/

// Expose the OpenAI Responses adapter in the generic ProviderStreams shape.
//
// `openai-responses.ts` exports `stream` and `streamSimple`.
// A module namespace import produces an object like:
//   { stream, streamSimple }
//
// TypeScript is structural, so that object satisfies ProviderStreams.
// Keeping this tiny factory matches the reference lazy adapter boundary:
// providers depend on `openAIResponsesApi()`, not on the concrete module file.
export const openAIResponsesApi = (): ProviderStreams => openAIResponses;

/*
    等价于：
    export const openAIResponsesApi = (): ProviderStreams => {
      return openAIResponses;
    };
*/
