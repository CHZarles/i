import type {
  AssistantMessage,
  AssistantMessageEventStream,
  // Conversation history passed into the model.
  Context,
  // Model metadata, including id/api/provider/baseUrl.
  Model,
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

type OpenAITextStreamEvent =
  // OpenAI says: a new output item started.
  // For this first slice, we only care when the item is an assistant message.
  | {
      type: "response.output_item.added";
      output_index: number;
      item: { type: string }; // type will be message / function_call /  thinking ...
    }
  // OpenAI says: here is the next piece of text for one output item.
  // Multiple delta events together become the final assistant text.
  | {
      type: "response.output_text.delta";
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
    };

export async function processResponsesStream(
  // The provider event source. In the test this is an async generator;
  // later it can be real SSE/network events.
  openaiStream: AsyncIterable<OpenAITextStreamEvent>,

  // The single assistant message being built in-place.
  // This function mutates output.content, output.usage, output.responseId.
  output: AssistantMessage,

  // The Pi event stream for live progress.
  // We mutate output and also push text_start/text_delta so upper layers can
  // render streaming text before the final assistant message is complete.
  stream: AssistantMessageEventStream,

  // Model metadata is not needed in the first slice, but the full parser uses it
  // for provider/model-specific details such as cost and compatibility.
  _model: Model<"openai-responses">,
): Promise<void> {
  // OpenAI usually gives us one network stream, but that stream can contain
  // multiple output items: text, tool calls, reasoning, etc.
  // output_index routes each delta to the Pi content block it belongs to.
  const textSlots = new Map<
    number,
    { block: { type: "text"; text: string }; contentIndex: number }
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
      // Ignore non-text output items for now. Tool calls/thinking come later.
      if (event.item.type !== "message") continue;

      // Create the Pi text block that future delta events will append to.
      const block = { type: "text" as const, text: "" };
      output.content.push(block);
      const contentIndex = output.content.length - 1;

      // Remember which OpenAI output_index owns this Pi text block and where it
      // lives in output.content, so later deltas report the same contentIndex.
      textSlots.set(event.output_index, { block, contentIndex });

      // Tell consumers that a new text block exists in output.content.
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

    const text = message.content.map((block) => block.text).join("");
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
