import type {
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
  StreamFunction,
  StreamOptions,
  Usage,
} from "../types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";

export interface OpenAIResponsesOptions extends StreamOptions {}

type OpenAIResponsesResponse = {
  id?: string;
  output_text?: string;
  output?: {
    content?: {
      type?: string;
      text?: string;
    }[];
  }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

function promptFromContext(context: Context): string {
  const lastUser = [...context.messages]
    .reverse()
    .find((message) => message.role === "user");
  return lastUser?.content ?? "";
}

function usageFromResponse(data: OpenAIResponsesResponse): Usage {
  const input = data.usage?.input_tokens ?? 0;
  const output = data.usage?.output_tokens ?? 0;
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: data.usage?.total_tokens ?? input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function outputText(data: OpenAIResponsesResponse): string {
  if (typeof data.output_text === "string") return data.output_text;
  return (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text ?? "")
    .join("");
}

function createMessage(
  model: Model<"openai-responses">,
  text: string,
  data?: OpenAIResponsesResponse,
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
  model: Model<"openai-responses">,
  error: unknown,
): AssistantMessage {
  return {
    ...createMessage(model, ""),
    stopReason: "error",
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

export const streamSimple: StreamFunction<
  "openai-responses",
  SimpleStreamOptions
> = (model, context, options): AssistantMessageEventStream => {
  const stream = new AssistantMessageEventStream();

  void (async () => {
    try {
      if (!options?.apiKey) throw new Error("No API key for provider");

      const partial = createMessage(model, "");
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
            input: promptFromContext(context),
          }),
        },
      );

      if (!res.ok) throw new Error(await res.text());

      const data = (await res.json()) as OpenAIResponsesResponse;
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

export const stream: StreamFunction<"openai-responses", StreamOptions> =
  streamSimple;
