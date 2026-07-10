import type {
  // Final assistant message type.
  AssistantMessage,
  // Model metadata, including id/api/provider/baseUrl.
  Model,
  // Options for the simplified stream entry.
  SimpleStreamOptions,
  // Standard function shape:
  // (model, context, options?) => AssistantMessageEventStream
  StreamFunction,
  // Common stream options: apiKey, maxTokens.
  StreamOptions,
  // Token/cost usage shape.
  Usage,
} from "../types.ts";

import {
  convertResponsesMessages,
  processResponsesStream,
} from "./openai-responses-shared.ts";

// Runtime import, because this class is instantiated with `new`.
import { AssistantMessageEventStream } from "../utils/event-stream.ts";

// OpenAI Responses API options.
// Currently identical to StreamOptions, but kept as an extension point.
export interface OpenAIResponsesOptions extends StreamOptions {}

// Minimal local type for the OpenAI /responses JSON result.
//
// It only includes fields this file actually reads.
// All fields are optional because the response may vary or errors may return
// partial/missing fields.
type OpenAIResponsesResponse = {
  // OpenAI response id, stored on AssistantMessage.responseId.
  id?: string;

  // Convenient plain text output field, used first when present.
  output_text?: string;

  // Structured output fallback.
  // Used when output_text is not present.
  output?: {
    content?: {
      // Example: "output_text".
      type?: string;

      // Text content for this part.
      text?: string;
    }[];
  }[];

  // Token usage reported by the API.
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

// Convert OpenAI response usage into the internal Usage shape.
function usageFromResponse(data: OpenAIResponsesResponse): Usage {
  // Optional chaining + fallback:
  // if data.usage?.input_tokens exists, use it; otherwise 0.
  const input = data.usage?.input_tokens ?? 0;

  // Same for output tokens.
  const output = data.usage?.output_tokens ?? 0;

  return {
    // Internal input token count.
    input,

    // Internal output token count.
    output,

    // Cache accounting is not implemented in this simplified adapter.
    cacheRead: 0,
    cacheWrite: 0,

    // Prefer provider-reported total; otherwise compute input + output.
    totalTokens: data.usage?.total_tokens ?? input + output,

    // Cost calculation is not implemented yet.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

// Extract assistant text from the OpenAI /responses result.
//
// Prefer the convenient output_text field.
// If absent, fall back to structured output[].content[] parts.
function outputText(data: OpenAIResponsesResponse): string {
  // Fast path: OpenAI may return final text directly here.
  if (typeof data.output_text === "string") return data.output_text;

  return (
    (data.output ?? [])
      // Collect all content parts from all output items.
      // Missing content becomes [].
      .flatMap((item) => item.content ?? [])

      // Only use text output parts.
      .filter((part) => part.type === "output_text")

      // Extract text from each part.
      // Missing text becomes "".
      .map((part) => part.text ?? "")

      // Concatenate all text parts into one assistant message.
      .join("")
  );
}

// Build an internal AssistantMessage from model + text + optional OpenAI response data.
function createMessage(
  // The model used for this request.
  model: Model<"openai-responses">,

  // Assistant output text.
  text: string,

  // Optional raw OpenAI response, used for responseId and usage.
  data?: OpenAIResponsesResponse,
): AssistantMessage {
  return {
    role: "assistant",

    // Internal message content is an array of content blocks.
    content: [{ type: "text", text }],

    // Keep provenance: which API/provider/model produced this message.
    api: model.api,
    provider: model.provider,
    model: model.id,

    // Provider response id, if available.
    responseId: data?.id,

    // Convert provider usage into internal Usage shape.
    usage: data ? usageFromResponse(data) : usageFromResponse({}),

    // Normal successful message by default.
    stopReason: "stop",

    // Unix timestamp in milliseconds.
    timestamp: Date.now(),
  };
}

// Build an AssistantMessage for a failed request.
//
// We still return AssistantMessage instead of throwing here,
// so success and failure can go through the same stream/message pipeline.
function createErrorMessage(
  // The model whose request failed.
  model: Model<"openai-responses">,

  // unknown because JavaScript can throw anything:
  // Error, string, object, etc.
  error: unknown,
): AssistantMessage {
  return {
    // Object spread syntax.
    //
    // createMessage(model, "") creates a normal empty assistant message:
    // {
    //   role: "assistant",
    //   content: [{ type: "text", text: "" }],
    //   api: model.api,
    //   provider: model.provider,
    //   model: model.id,
    //   usage: zeroUsage,
    //   stopReason: "stop",
    //   timestamp: ...
    // }
    //
    // The leading ... copies all those fields into this new object.
    ...createMessage(model, ""),

    // Fields written after the spread override copied fields.
    // So this changes stopReason from "stop" to "error".
    stopReason: "error",

    // Normalize the thrown value into a readable string.
    //
    // If it is an Error object, use error.message.
    // Otherwise convert it with String(error).
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

// fetch() 返回 HTTP Response，不是 OpenAI event。
// `stream: true` 只把响应 body 变成 SSE 文本，例如：
//   data: {"type":"response.output_text.delta","delta":"Hel"}
// 这个 helper 把 SSE 文本转成 processResponsesStream 能消费的 event 对象。
async function* parseResponsesSse(response: Response): AsyncGenerator<any> {
  if (!response.body) throw new Error("Missing response body");

  // 简化实现：await response.text() 等到 body 结束后一次性拿完整文本。
  // 例子：body 文本可能长这样：
  //   data: {"type":"response.output_text.delta","delta":"Hel"}\n\n
  //   data: {"type":"response.output_text.delta","delta":"lo"}\n\n
  // text.split("\n\n") 会得到两个 frame；下面的 yield 会依次吐出两个 event 对象。
  // 生产级实现会用 response.body.getReader() 边收到 chunk 边解析。
  const text = await response.text();

  // SSE 用空行分隔 event；OpenAI 的 JSON payload 在 data 行里。
  for (const frame of text.split("\n\n")) {
    const line = frame.split("\n").find((line) => line.startsWith("data:"));

    if (!line) continue;

    // 去掉 SSE 的 "data:" 前缀，剩下的就是一个 provider event 的 JSON。
    const data = line.slice("data:".length).trim();
    if (!data || data === "[DONE]") continue;

    yield JSON.parse(data);
  }
}

// Simple OpenAI Responses stream implementation.
// Returns immediately with an AssistantMessageEventStream;
// the async request below pushes start/done/error events into it.
export const streamSimple: StreamFunction<
  "openai-responses",
  SimpleStreamOptions
> = (model, context, options): AssistantMessageEventStream => {
  // Create the event stream returned to the caller.
  // The stream starts empty; events will be pushed by the async task below.
  const stream = new AssistantMessageEventStream();

  // Start the actual request in the background.
  //
  // (async () => { ... })()
  // means: define an async function and call it immediately.
  //
  // async functions return Promise.
  // `void` means we intentionally do not await that Promise here,
  // because this function must return the stream immediately.
  //
  void (async () => {
    // return stream now, do network request later, push events into stream as work progresses
    try {
      // Need an API key before calling OpenAI.
      // options?.apiKey safely handles options === undefined.
      if (!options?.apiKey) throw new Error("No API key for provider");

      // Create an empty assistant message as the initial partial message.
      // This tells the caller: assistant response has started.
      const partial = createMessage(model, "");

      // Emit the start event into AssistantMessageEventStream.
      stream.push({ type: "start", partial });

      const res = await fetch(
        `${model.baseUrl.replace(/\/+$/, "")}/responses`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: model.id,
            input: convertResponsesMessages(model, context),
            // 要求 OpenAI 返回 SSE frame，而不是一个最终 JSON 对象。
            // 注意：fetch 的返回值仍然是 Response，不是 event iterator。
            stream: true,
          }),
        },
      );

      if (!res.ok) throw new Error(await res.text());

      const output = createMessage(model, "");
      output.content = [];

      // Adapter 边界：
      //   parseResponsesSse(res)      -> "data: {...}" 文本变成 provider event
      //   processResponsesStream(...) -> provider event 更新 output 和 Pi stream
      await processResponsesStream(
        parseResponsesSse(res),
        output,
        stream,
        model,
      );

      if (output.stopReason === "error") {
        throw new Error(
          output.errorMessage ?? "OpenAI Responses stream failed",
        );
      }

      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      const message = createErrorMessage(model, error);
      stream.push({ type: "error", reason: "error", error: message });
      stream.end(message);
    }
  })();

  return stream;
};

export const stream: StreamFunction<"openai-responses", StreamOptions> =
  streamSimple;
