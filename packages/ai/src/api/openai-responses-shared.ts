import type {
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
