import test from "node:test";
import assert from "node:assert/strict";

import { iterateAnthropicEvents } from "../src/api/anthropic-messages.ts";

test("iterateAnthropicEvents parses a complete Anthropic event stream", async () => {
  const messageStart = {
    type: "message_start",
    message: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [],
      model: "MiniMax-M3",
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 0,
      },
    },
  };

  const response = new Response(
    [
      "event: message_start",
      `data: ${JSON.stringify(messageStart)}`,
      "",
      "event: message_stop",
      'data: {"type":"message_stop"}',
      "",
      "",
    ].join("\n"),
  );

  const types: string[] = [];

  for await (const event of iterateAnthropicEvents(response)) {
    types.push(event.type);
  }

  assert.deepEqual(types, ["message_start", "message_stop"]);
});
