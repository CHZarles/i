import type {
  AssistantMessage,
  AssistantMessageEventStream,
  // Conversation history passed into the model.
  Context,
  // Model metadata, including id/api/provider/baseUrl.
  Model,
  ToolCall,
  TextContent,
} from "../types.ts";

type ResponsesInputItem =
  | { role: "system" | "developer"; content: string }
  | { role: "user"; content: { type: "input_text"; text: string }[] }
  | {
      type: "message";
      role: "assistant";
      content: { type: "output_text"; text: string; annotations: [] }[];
      status: "completed";
    };

type OpenAIMessageItem = {
  type: "message";
  content?: { type: string; text?: string }[];
};

type OpenAIFunctionCallItem = {
  type: "function_call";
  id: string;
  call_id: string;
  name: string;
  arguments?: string;
};

type OpenAIUnsupportedItem = {
  type: "reasoning";
};

type OpenAITextStreamEvent =
  // OpenAI says: a new output item started.
  // For this first slice, we only care when the item is an assistant message.
  | {
      type: "response.output_item.added";
      output_index: number;
      item: OpenAIMessageItem | OpenAIFunctionCallItem | OpenAIUnsupportedItem;
    }
  // OpenAI says: here is the next piece of text for one output item.
  // Multiple delta events together become the final assistant text.
  | {
      type: "response.output_text.delta";
      output_index: number;
      delta: string;
    }
  // tool related
  | {
      type: "response.function_call_arguments.delta";
      output_index: number;
      delta: string;
    }
  // OpenAI says: the response is finished, and here is final metadata.
  // This event gives us response id, stop state, and token usage.
  | {
      type: "response.completed";
      response: {
        id?: string;
        status?: string;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          total_tokens?: number;
        };
      };
    }
  // OpenAI says: the response is failed
  | {
      type: "response.failed";
      response?: {
        error?: { code?: string; message?: string };
      };
    }
  | {
      type: "response.output_item.done";
      output_index: number;
      item: OpenAIMessageItem | OpenAIFunctionCallItem | OpenAIUnsupportedItem;
    };

/*
  response.output_item.done = one output block is finished
  response.completed        = whole model response is finished


  One assistant response
    ├─ output item 0: text message
    ├─ output item 1: tool call
    └─ final response metadata

  OpenAI may send:

  response.output_item.done   // text block finished
  response.output_item.done   // tool call block finished
  response.completed          // whole response finished
*/

export async function processResponsesStream(
  // The provider event source. In the test this is an async generator;
  // later it can be real SSE/network events.
  openaiStream: AsyncIterable<OpenAITextStreamEvent>,

  // The single assistant message being built in-place.
  // This function mutates output.content, output.usage, output.responseId.
  // 这个数据结构面向, the assistant message being built
  output: AssistantMessage,

  // The Pi event stream for live progress.
  // We mutate output and also push text_start/text_delta so upper layers can
  // render streaming text before the final assistant message is complete.
  // 这个数据结构面向, the notification channel while it is being built
  stream: AssistantMessageEventStream,

  // Model metadata is not needed in the first slice, but the full parser uses it
  // for provider/model-specific details such as cost and compatibility.
  _model: Model<"openai-responses">,
): Promise<void> {
  // OpenAI usually gives us one network stream, but that stream can contain
  // multiple output items: text, tool calls, reasoning, etc.
  // output_index routes each delta to the Pi content block it belongs to.
  // 普通 chat 通常只有一个 text output，但 Responses 协议用 output_index
  // 标记每个 output item。event.type 只告诉我们这是 text delta；
  // output_index 才告诉我们要更新哪一个 text block。
  const textSlots = new Map<
    number,
    { block: { type: "text"; text: string }; contentIndex: number }
  >();
  const toolCallSlots = new Map<
    number,
    { block: ToolCall; contentIndex: number; partialJson: string }
  >();
  // A stream that ends without response.completed is incomplete/corrupt.
  let sawCompleted = false;

  for await (const event of openaiStream) {
    if (event.type === "response.failed") {
      const error = event.response?.error;

      throw new Error(
        error
          ? `${error.code ?? "unknown"}: ${error.message ?? "no message"}`
          : "Unknown error (no error details in response)",
      );
    }
    if (event.type === "response.output_item.added") {
      if (event.item.type === "function_call") {
        const block: ToolCall = {
          type: "toolCall",
          id: `${event.item.call_id}|${event.item.id}`,
          name: event.item.name,
          arguments: {},
        };

        output.content.push(block);
        toolCallSlots.set(event.output_index, {
          block,
          contentIndex: output.content.length - 1,
          partialJson: event.item.arguments ?? "",
        });

        continue;
      }

      // Thinking/reasoning items are not supported in this slice yet.
      if (event.item.type !== "message") continue;

      const block = { type: "text" as const, text: "" };
      output.content.push(block);
      const contentIndex = output.content.length - 1;

      textSlots.set(event.output_index, { block, contentIndex });

      stream.push({
        type: "text_start",
        contentIndex,
        partial: output,
      });
      continue;
    }
    if (event.type === "response.output_text.delta") {
      // Find the text block created by response.output_item.added.
      const slot = textSlots.get(event.output_index);
      if (!slot) continue;

      // Mutate the same object already stored inside output.content.
      slot.block.text += event.delta;

      // Tell consumers about only the new text piece.
      // Use the contentIndex created with the block, not a hardcoded position.
      stream.push({
        type: "text_delta",
        contentIndex: slot.contentIndex,
        delta: event.delta,
        partial: output,
      });
      continue;
    }

    if (event.type === "response.function_call_arguments.delta") {
      const slot = toolCallSlots.get(event.output_index);
      if (!slot) continue;

      slot.partialJson += event.delta;

      // 当前 slice 只把最终 ToolCall 存进 output.content。
      // 这里暂时不向 stream 推送 toolcall_start/toolcall_delta/toolcall_end；
      // 完整 Pi 会在下一步把 tool call 的流式进度也通知给上层。
      continue;
    }

    if (event.type === "response.completed") {
      sawCompleted = true;

      // Copy provider metadata into Pi's assistant message shape.
      output.responseId = event.response.id;
      output.stopReason = "stop";

      // OpenAI names these fields input_tokens/output_tokens.
      // Pi's internal Usage shape names them input/output.
      const input = event.response.usage?.input_tokens ?? 0;
      const outputTokens = event.response.usage?.output_tokens ?? 0;

      output.usage = {
        input,
        output: outputTokens,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: event.response.usage?.total_tokens ?? input + outputTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      };
    }

    if (event.type === "response.output_item.done") {
      if (event.item.type === "function_call") {
        const slot = toolCallSlots.get(event.output_index);
        if (!slot) continue;

        slot.block.arguments = JSON.parse(
          event.item.arguments || slot.partialJson || "{}",
        ) as Record<string, unknown>;

        toolCallSlots.delete(event.output_index);
        continue;
      }

      // Thinking/reasoning items are not supported in this slice yet.
      if (event.item.type !== "message") continue;

      const slot = textSlots.get(event.output_index);
      if (!slot) continue;

      slot.block.text =
        event.item.content
          ?.filter((part) => part.type === "output_text")
          .map((part) => part.text ?? "")
          .join("") ?? slot.block.text;

      stream.push({
        type: "text_end",
        contentIndex: slot.contentIndex,
        content: slot.block.text,
        partial: output,
      });

      textSlots.delete(event.output_index);

      continue;
    }
  }

  if (!sawCompleted) {
    throw new Error("OpenAI Responses stream ended before completed event");
  }
}

export function convertResponsesMessages(
  model: Model<"openai-responses">,
  context: Context,
): ResponsesInputItem[] {
  const input: ResponsesInputItem[] = [];

  if (context.systemPrompt) {
    input.push({
      role: model.reasoning ? "developer" : "system",
      content: context.systemPrompt,
    });
  }

  for (const message of context.messages) {
    if (message.role === "user") {
      input.push({
        role: "user",
        content: [{ type: "input_text", text: message.content }],
      });
      continue;
    }

    const text = message.content
      .filter((block): block is TextContent => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (!text) continue;

    input.push({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text, annotations: [] }],
      status: "completed",
    });
  }

  return input;
}
