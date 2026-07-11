import type {
  AssistantMessage,
  Context,
  Message,
  Model,
  SimpleStreamOptions,
  StreamFunction,
  StreamOptions,
  Usage,
} from "../types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";

import type {
  MessageCreateParamsStreaming,
  MessageParam,
} from "@anthropic-ai/sdk/resources/messages.js";

type AnthropicMessagesConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens?: number;
};

export interface AnthropicMessagesOptions extends StreamOptions {}

type AnthropicMessagesResponse = {
  id?: string;
  content?: {
    type?: string;
    text?: string;
  }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

function promptFromContext(context: Context): string {
  const lastUser = [...context.messages]
    .reverse()
    .find((message) => message.role === "user");
  return lastUser?.content ?? "";
}

export function convertMessages(messages: Message[]): MessageParam[] {
  const params: MessageParam[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      params.push({
        role: "user",
        content: message.content,
      });
      continue;
    }

    const content: { type: "text"; text: string }[] = [];

    for (const block of message.content) {
      if (block.type === "text") {
        content.push({
          type: "text",
          text: block.text,
        });
      }
    }

    if (content.length > 0) {
      params.push({
        role: "assistant",
        content,
      });
    }
  }

  return params;
}

export function buildParams(
  model: Model<"anthropic-messages">,
  context: Context,
  options?: AnthropicMessagesOptions,
): MessageCreateParamsStreaming {
  const params: MessageCreateParamsStreaming = {
    model: model.id,
    messages: convertMessages(context.messages),
    max_tokens: options?.maxTokens ?? model.maxTokens,
    stream: true,
  };

  if (context.systemPrompt) {
    params.system = [
      {
        type: "text",
        text: context.systemPrompt,
      },
    ];
  }

  return params;
}

function usageFromResponse(data: AnthropicMessagesResponse): Usage {
  const input = data.usage?.input_tokens ?? 0;
  const output = data.usage?.output_tokens ?? 0;
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function outputText(data: AnthropicMessagesResponse): string {
  return (data.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

function createMessage(
  model: Model<"anthropic-messages">,
  text: string,
  data?: AnthropicMessagesResponse,
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    responseId: data?.id,
    usage: data ? usageFromResponse(data) : usageFromResponse({}),
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function createErrorMessage(
  model: Model<"anthropic-messages">,
  error: unknown,
): AssistantMessage {
  return {
    ...createMessage(model, ""),
    stopReason: "error",
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

export async function callAnthropicMessages(
  config: AnthropicMessagesConfig,
  prompt: string,
) {
  if (!config.apiKey) {
    throw new Error("No API key for provider");
  }

  const url = `${config.baseUrl.replace(/\/+$/, "")}/v1/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens ?? 1024,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const data = await res.json();

  return outputText(data as AnthropicMessagesResponse);
}

export const streamSimple: StreamFunction<
  "anthropic-messages",
  SimpleStreamOptions
> = (model, context, options): AssistantMessageEventStream => {
  const stream = new AssistantMessageEventStream();

  void (async () => {
    try {
      if (!options?.apiKey) throw new Error("No API key for provider");

      const partial = createMessage(model, "");
      stream.push({ type: "start", partial });

      const res = await fetch(
        `${model.baseUrl.replace(/\/+$/, "")}/v1/messages`,
        {
          method: "POST",
          headers: {
            "x-api-key": options.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: model.id,
            max_tokens: options.maxTokens ?? model.maxTokens,
            messages: [
              {
                role: "user",
                content: promptFromContext(context),
              },
            ],
          }),
        },
      );

      if (!res.ok) throw new Error(await res.text());

      const data = (await res.json()) as AnthropicMessagesResponse;
      const message = createMessage(model, outputText(data), data);

      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
    } catch (error) {
      const message = createErrorMessage(model, error);
      stream.push({ type: "error", reason: "error", error: message });
      stream.end(message);
    }
  })();

  return stream;
};

export const stream: StreamFunction<"anthropic-messages", StreamOptions> =
  streamSimple;
