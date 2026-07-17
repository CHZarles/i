import OpenAI from "openai";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import type {
  // Final assistant message type.
  AssistantMessage,
  // Conversation history passed into the model.
  Context,
  // Model metadata, including id/api/provider/baseUrl.
  Model,
  // Options for the simplified stream entry.
  SimpleStreamOptions,
  // Standard function shape:
  // (model, context, options?) => AssistantMessageEventStream
  StreamFunction,
  // Common stream options: apiKey, maxTokens.
  StreamOptions,
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

function createMessage(model: Model<"openai-responses">): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function createClient(
  model: Model<"openai-responses">,
  apiKey: string,
): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: model.baseUrl,
    dangerouslyAllowBrowser: true,
  });
}

function buildParams(
  model: Model<"openai-responses">,
  context: Context,
  options?: OpenAIResponsesOptions,
): ResponseCreateParamsStreaming {
  const params: ResponseCreateParamsStreaming = {
    model: model.id,
    input: convertResponsesMessages(model, context),
    stream: true,
    store: false,
  };

  if (options?.maxTokens) {
    params.max_output_tokens = options.maxTokens;
  }

  return params;
}

// Simple OpenAI Responses stream implementation.
// Returns immediately with an AssistantMessageEventStream;
// the async request below pushes start/done/error events into it.
export const streamSimple: StreamFunction<
  "openai-responses",
  SimpleStreamOptions
> = (model, context, options): AssistantMessageEventStream => {
  const stream = new AssistantMessageEventStream();
  const output = createMessage(model);

  void (async () => {
    try {
      if (!options?.apiKey) throw new Error("No API key for provider");

      const client = createClient(model, options.apiKey);
      const params = buildParams(model, context, options);

      // OpenAI SDK 负责 HTTP 请求和 SSE 解码，data 已经是可 for-await 的事件流。
      // Pi 只负责把 SDK 事件转换成 AssistantMessage 和上层进度事件。
      const { data: openaiStream } = await client.responses
        .create(params, { maxRetries: 0 })
        .withResponse();

      stream.push({ type: "start", partial: output });
      await processResponsesStream(openaiStream, output, stream, model);

      if (output.stopReason === "error") {
        throw new Error(
          output.errorMessage ?? "OpenAI Responses stream failed",
        );
      }

      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      output.stopReason = "error";
      output.errorMessage =
        error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: "error", error: output });
      stream.end();
    }
  })();

  return stream;
};

export const stream: StreamFunction<"openai-responses", StreamOptions> =
  streamSimple;
