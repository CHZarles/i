import type { ToolCall, ToolResultMessage } from "../types.ts";

export function createToolResultMessage(
  toolCall: ToolCall, // 之前模型发起的那次调用
  result: unknown,
  isError = false,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [
      {
        type: "text",
        text: typeof result === "string" ? result : JSON.stringify(result),
      },
    ],
    isError,
    timestamp: Date.now(),
  };
}
