import type {
  AssistantMessage,
  Context,
  Message,
  Model,
  SimpleStreamOptions,
  StreamFunction,
  StreamOptions,
  TextContent,
  Usage,
} from "../types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";

import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageCreateParamsStreaming,
  MessageParam,
  RawMessageStreamEvent,
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

// 一个已经完成分帧的 SSE 传输帧，是交给下一层使用的稳定快照。
// 它和 SseDecoderState 保存的是同一类信息，但生命周期不同：
// ServerSentEvent 已经完成，`data` 已从多行 string[] 合并成一个 string，
// 返回后不会再因为解码器开始处理下一帧而被清空。
// `data` 仍然是 JSON 字符串，后续才会通过 JSON.parse 转成普通对象，
// 并由 SDK 的 RawMessageStreamEvent 类型检查 Anthropic 事件结构。
export interface ServerSentEvent {
  event: string | null;
  data: string;
  raw: string[];
}

// 当前 SSE 帧的“临时记事本”，由解码器持有并不断修改。
// 它表示尚未完成的帧，因此 `data` 是 string[]，用来逐行收集内容；
// 读到空行后，这些内容会生成 ServerSentEvent，然后 state 会被清空复用。
//
//   event: message_start  -> state.event
//   data: {"type": ...}   -> state.data
//   原始的两行文本        -> state.raw
//
// 只有读到空行后，这些临时数据才会组成一个完整的 ServerSentEvent。
export interface SseDecoderState {
  event: string | null;
  data: string[];
  raw: string[];
}

// 只接受 Anthropic Messages 协议中会影响消息内容和生命周期的事件。
const ANTHROPIC_MESSAGE_EVENTS: ReadonlySet<string> = new Set([
  "message_start",
  "message_delta",
  "message_stop",
  "content_block_start",
  "content_block_delta",
  "content_block_stop",
]);

// 在读到空行时结束当前帧：
//
//   未完成的 SseDecoderState
//            |
//            v
//      flushSseEvent()
//       |            |
//       v            v
//   返回完整帧     清空 state，准备接收下一帧
//
// 返回值使用当前数据的快照，清空 state 不会破坏已经返回的帧。
function flushSseEvent(state: SseDecoderState): ServerSentEvent | null {
  // state 中没有 event 和 data，说明这只是空内容，不生成事件。
  if (!state.event && state.data.length === 0) {
    return null;
  }

  // 把可变的“未完成状态”转换为独立的“已完成帧”：
  // state.data: string[] -> event.data: string。
  // 同时复制 raw 数组，后面清空 state 时不会影响返回的 event。
  const event: ServerSentEvent = {
    event: state.event,
    data: state.data.join("\n"),
    raw: [...state.raw],
  };

  // 当前帧已经完成，重置临时状态，下一条 SSE 帧将从空状态开始。
  state.event = null;
  state.data = [];
  state.raw = [];

  return event;
}

// 服务端的一帧 SSE 文本：
//
//   event: message_start
//   data: {"type":"message_start"}
//   <空行>
//
// 上面的三行会分别调用三次 decodeSseLine：
//
//   第 1 次：保存 event，帧还没结束，所以返回 null
//   第 2 次：保存 data， 帧还没结束，所以返回 null
//   第 3 次：读到空行，说明帧结束，返回完整的 ServerSentEvent
//
//   网络行 -> decodeSseLine -> 暂存到 state
//                              |
//                           遇到空行
//                              |
//                              v
//                    返回完整帧并清空 state
export function decodeSseLine(
  line: string,
  state: SseDecoderState,
): ServerSentEvent | null {
  // SSE 协议用空行表示当前帧结束。
  if (line === "") {
    return flushSseEvent(state);
  }

  // 保存服务端返回的原始行
  // 后续解析失败时可以输出更有用的诊断信息。
  state.raw.push(line);

  // 以 ':' 开头的是 SSE 注释或用于保持连接的心跳行
  // 不包含业务数据。
  if (line.startsWith(":")) {
    return null;
  }

  // 找到第一个冒号，它负责分隔 SSE 字段名和值。
  // 例如 `data: {"type":"message_start"}` 中的索引是 4。
  const delimiterIndex = line.indexOf(":");

  // 有冒号时取冒号前面的字段名，例如 `data` 或 `event`；
  // 没有冒号时，整行都被视为字段名。
  const fieldName =
    delimiterIndex === -1 ? line : line.slice(0, delimiterIndex);

  // 有冒号时取冒号后面的全部内容；只使用第一个冒号，
  // 所以 JSON 字符串内部的其他冒号不会被破坏。
  let value = delimiterIndex === -1 ? "" : line.slice(delimiterIndex + 1);

  // SSE 允许冒号后带一个可选空格，这个空格不属于真正的字段值。
  if (value.startsWith(" ")) {
    value = value.slice(1);
  }

  // Anthropic 使用 `event:` 指定事件名，
  // 使用一个或多个 `data:` 行传输事件的 JSON 字符串。
  if (fieldName === "event") {
    state.event = value;
  } else if (fieldName === "data") {
    state.data.push(value);
  }

  return null;
}

// 在文本缓冲区中查找最早出现的换行符位置。
// 同时支持 Unix 的 `\n` 和旧式/网络文本中的 `\r`。
function nextLineBreakIndex(text: string): number {
  const carriageReturnIndex = text.indexOf("\r");
  const newlineIndex = text.indexOf("\n");
  if (carriageReturnIndex === -1) {
    return newlineIndex;
  }
  if (newlineIndex === -1) {
    return carriageReturnIndex;
  }
  return Math.min(carriageReturnIndex, newlineIndex);
}

// 从 buffer 中取出一条完整的文本行：
//
//   "event: message_start\n剩余内容"
//              |
//              v
//   { line: "event: message_start", rest: "剩余内容" }
//
// 如果还没有收到换行符，说明这一行可能被拆在两个网络chunk 中，返回 null。
function consumeLine(text: string): { line: string; rest: string } | null {
  const lineBreakIndex = nextLineBreakIndex(text);

  if (lineBreakIndex === -1) {
    return null;
  }

  let nextIndex = lineBreakIndex + 1;

  // `\r\n` 是一个完整换行符，需要同时跳过两个字符。
  if (text[lineBreakIndex] === "\r" && text[nextIndex] === "\n") {
    nextIndex += 1;
  }

  return {
    line: text.slice(0, lineBreakIndex),
    rest: text.slice(nextIndex),
  };
}

// 从 HTTP Response.body 持续读取任意大小的二进制 chunk：
//
//   Uint8Array chunk
//          |
//          v
//   TextDecoder 转成文本并追加到 buffer
//          |
//          v
//   consumeLine() 取出完整行
//          |
//          v
//   decodeSseLine() 组合 SSE 帧
//          |
//          v
//   yield ServerSentEvent
//
// buffer 专门保留尚未形成完整一行的文本，等待下一个chunk 补齐。
export async function* iterateSseMessages(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<ServerSentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const state: SseDecoderState = {
    event: null,
    data: [],
    raw: [],
  };

  // 保存还没有形成完整一行的文本，等待下一个 chunk 补齐。
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        throw new Error("Request was aborted");
      }

      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      // `{ stream: true }` 表示后续还有字节，保留未完成的 UTF-8 字符。
      buffer += decoder.decode(value, { stream: true });

      let consumed = consumeLine(buffer);

      while (consumed) {
        buffer = consumed.rest;

        const event = decodeSseLine(consumed.line, state);

        if (event) {
          yield event;
        }

        consumed = consumeLine(buffer);
      }
    }

    // 网络流结束后，取出 TextDecoder 内部可能残留的最后几个字节。
    buffer += decoder.decode();

    let consumed = consumeLine(buffer);

    while (consumed) {
      buffer = consumed.rest;

      const event = decodeSseLine(consumed.line, state);

      if (event) {
        yield event;
      }

      consumed = consumeLine(buffer);
    }

    // 最后一行可能没有换行符，也要交给 SSE 行解码器。
    if (buffer.length > 0) {
      const event = decodeSseLine(buffer, state);

      if (event) {
        yield event;
      }
    }

    // 响应可能没有以空行结尾，仍然需要提交最后一个未完成的帧。
    const trailingEvent = flushSseEvent(state);

    if (trailingEvent) {
      yield trailingEvent;
    }
  } finally {
    // 无论正常完成、取消还是异常，都必须释放Response.body 的读取锁。
    reader.releaseLock();
  }
}

// 把通用 SSE 帧转换成 Anthropic SDK 定义的事件对象。
// `yield` 会让调用方通过 `for await` 逐个收到事件。
export async function* iterateAnthropicEvents(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<RawMessageStreamEvent> {
  if (!response.body) {
    throw new Error(
      "Attempted to iterate over an Anthropic response with no body",
    );
  }

  let sawMessageStart = false;
  let sawMessageStop = false;

  for await (const sse of iterateSseMessages(response.body, signal)) {
    if (sse.event === "error") {
      throw new Error(sse.data);
    }

    // 忽略 ping 等不属于 Anthropic 消息生命周期的 SSE 帧。
    if (!ANTHROPIC_MESSAGE_EVENTS.has(sse.event ?? "")) {
      continue;
    }

    let event: RawMessageStreamEvent;

    try {
      event = JSON.parse(sse.data) as RawMessageStreamEvent;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      throw new Error(
        `Could not parse Anthropic SSE event ${sse.event}: ` +
          `${message}; data=${sse.data}; raw=${sse.raw.join("\\n")}`,
      );
    }

    if (event.type === "message_start") {
      sawMessageStart = true;
    } else if (event.type === "message_stop") {
      sawMessageStop = true;
    }

    yield event;
  }

  // 已经开始的 Anthropic 消息必须由 message_stop 正常结束。
  if (sawMessageStart && !sawMessageStop) {
    throw new Error("Anthropic stream ended before message_stop");
  }
}

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

  const output: AssistantMessage = {
    ...createMessage(model, ""),
    content: [],
  };

  void (async () => {
    try {
      if (!options?.apiKey) {
        throw new Error("No API key for provider");
      }

      const client = new Anthropic({
        apiKey: options.apiKey,
        baseURL: model.baseUrl,
        maxRetries: 0,
        dangerouslyAllowBrowser: true,
      });

      const params = buildParams(model, context, options);
      const response = await client.messages
        .create({ ...params, stream: true })
        .asResponse();

      stream.push({ type: "start", partial: output });

      // Anthropic 的 block index 和 Pi output.content 的数组下标属于不同协议层。
      const textSlots = new Map<number, number>();

      for await (const event of iterateAnthropicEvents(response)) {
        if (event.type === "message_start") {
          output.responseId = event.message.id;
          output.usage.input = event.message.usage.input_tokens ?? 0;
          output.usage.output = event.message.usage.output_tokens ?? 0;
          output.usage.totalTokens = output.usage.input + output.usage.output;
          continue;
        }

        if (
          event.type === "content_block_start" &&
          event.content_block.type === "text"
        ) {
          const block: TextContent = { type: "text", text: "" };
          output.content.push(block);

          const contentIndex = output.content.length - 1;
          textSlots.set(event.index, contentIndex);

          stream.push({ type: "text_start", contentIndex, partial: output });
          continue;
        }

        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          const contentIndex = textSlots.get(event.index);
          if (contentIndex === undefined) continue;

          const block = output.content[contentIndex];
          if (!block || block.type !== "text") continue;

          block.text += event.delta.text;
          stream.push({
            type: "text_delta",
            contentIndex,
            delta: event.delta.text,
            partial: output,
          });
          continue;
        }

        if (event.type === "content_block_stop") {
          const contentIndex = textSlots.get(event.index);
          if (contentIndex === undefined) continue;

          const block = output.content[contentIndex];
          if (!block || block.type !== "text") continue;

          stream.push({
            type: "text_end",
            contentIndex,
            content: block.text,
            partial: output,
          });

          textSlots.delete(event.index);
          continue;
        }

        if (event.type === "message_delta") {
          output.stopReason =
            event.delta.stop_reason === "tool_use" ? "toolUse" : "stop";
          output.usage.output =
            event.usage.output_tokens ?? output.usage.output;
          output.usage.totalTokens = output.usage.input + output.usage.output;
        }
      }

      const reason = output.stopReason === "toolUse" ? "toolUse" : "stop";
      stream.push({ type: "done", reason, message: output });
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

export const stream: StreamFunction<"anthropic-messages", StreamOptions> =
  streamSimple;
