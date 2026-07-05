export type KnownApi = "openai-responses" | "anthropic-messages";
export type Api = KnownApi | (string & {});
export type ProviderEnv = Record<string, string>;
export type ProviderHeaders = Record<string, string | null>;
export type KnownProvider = "openai" | "minimax";
export type ProviderId = KnownProvider | (string & {});

// Model interface for the unified model system
export interface Model<TApi extends Api = Api> {
  id: string;
  name: string;
  api: TApi;
  provider: ProviderId;
  baseUrl: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  contextWindow: number;
  maxTokens: number;
}

export type { AssistantMessageEventStream } from "./utils/event-stream.ts";
import type { AssistantMessageEventStream } from "./utils/event-stream.ts";

export interface StreamOptions {
  apiKey?: string;
  maxTokens?: number;
}

export interface SimpleStreamOptions extends StreamOptions {}

export interface TextContent {
  type: "text";
  text: string;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export type StopReason = "stop" | "error";

export interface UserMessage {
  role: "user";
  content: string;
  timestamp: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: TextContent[];
  api: Api;
  provider: ProviderId;
  model: string;
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number;
  responseId?: string;
}

export type Message = UserMessage | AssistantMessage;

export interface Context {
  messages: Message[];
}

export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "done"; reason: "stop"; message: AssistantMessage }
  | { type: "error"; reason: "error"; error: AssistantMessage };

export type StreamFunction<
  TApi extends Api = Api,
  TOptions extends StreamOptions = StreamOptions,
> = (
  model: Model<TApi>,
  context: Context,
  options?: TOptions,
) => AssistantMessageEventStream;

export interface ProviderStreams {
  stream(
    model: Model<Api>,
    context: Context,
    options?: StreamOptions,
  ): AssistantMessageEventStream;
  streamSimple(
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream;
}

export type ApiStreamOptions<TApi extends Api> = StreamOptions &
  Record<string, unknown>;
