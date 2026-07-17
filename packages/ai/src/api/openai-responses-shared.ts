import type {
  ResponseInput,
  ResponseStreamEvent,
} from "openai/resources/responses/responses.js";
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
  openaiStream: AsyncIterable<ResponseStreamEvent>,

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
        stream.push({
          type: "toolcall_start",
          contentIndex: output.content.length - 1,
          partial: output,
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

      stream.push({
        type: "toolcall_delta",
        contentIndex: slot.contentIndex,
        delta: event.delta,
        partial: output,
      });
      continue;
    }

    if (event.type === "response.completed") {
      sawCompleted = true;

      // Copy provider metadata into Pi's assistant message shape.
      output.responseId = event.response.id;
      output.stopReason = output.content.some((block) => block.type === "toolCall")
        ? "toolUse"
        : "stop";

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
        stream.push({
          type: "toolcall_end",
          contentIndex: slot.contentIndex,
          toolCall: slot.block,
          partial: output,
        });
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
): ResponseInput {
  const input: ResponseInput = [];

  if (context.systemPrompt) {
    input.push({
      role: model.reasoning ? "developer" : "system",
      content: context.systemPrompt,
    });
  }

  for (const [messageIndex, message] of context.messages.entries()) {
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
      id: `msg_pi_${messageIndex}`,
      role: "assistant",
      content: [{ type: "output_text", text, annotations: [] }],
      status: "completed",
    });
  }

  return input;
}
