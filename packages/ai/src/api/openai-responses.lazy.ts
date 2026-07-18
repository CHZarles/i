import type { ProviderStreams } from "../types.ts";

import * as openAIResponses from "./openai-responses.ts";

/* 
  语法解析
  1. export const openAIResponsesApi —— 导出一个常量 openAIResponsesApi                                                         
  2. = () —— 赋值一个无参数的箭头函数 ,  : ProviderStreams —— 函数的返回类型标注
  3. => openAIResponses —— 函数体只有一行表达式，返回 openAIResponses 这个值
*/
export const openAIResponsesApi = (): ProviderStreams => openAIResponses;

/*
    等价于：
    export const openAIResponsesApi = (): ProviderStreams => {
      return openAIResponses;
    };
*/
