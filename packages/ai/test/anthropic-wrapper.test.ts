import test from "node:test";
import assert from "node:assert/strict";

import { streamSimple } from "../src/api/anthropic-messages.ts";
import { minimaxProvider } from "../src/providers/minimax.ts";
import type { Context } from "../src/types.ts";

function sseResponse(
  events: Array<{ type: string; [key: string]: unknown }>,
): Response {
  const body = events
    .map(
      (event) =>
        `event: ${event.type}\n` + `data: ${JSON.stringify(event)}\n\n`,
    )
    .join("");

  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

test("streamSimple converts a MiniMax Anthropic text stream", async () => {
  const model = minimaxProvider().getModels()[0];
  assert.ok(model);

  const context: Context = {
    systemPrompt: "Be concise.",
    messages: [{ role: "user", content: "Hello", timestamp: 1 }],
  };

  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  try {
    globalThis.fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;

      return sseResponse([
        {
          type: "message_start",
          message: {
            id: "msg_1",
            type: "message",
            role: "assistant",
            content: [],
            model: "MiniMax-M3",
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hi" },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 1 },
        },
        { type: "message_stop" },
      ]);
    };

    const stream = streamSimple(model, context, {
      apiKey: "test-key",
      maxTokens: 64,
    });

    const seen: string[] = [];

    const reader = (async () => {
      for await (const event of stream) {
        seen.push(event.type);
      }
    })();

    const result = await stream.result();
    await reader;

    assert.equal(
      capturedUrl,
      "https://api.minimax.io/anthropic/v1/messages",
    );

    const requestBody = JSON.parse(String(capturedInit?.body));

    assert.equal(requestBody.model, "MiniMax-M3");
    assert.equal(requestBody.max_tokens, 64);
    assert.equal(requestBody.stream, true);
    assert.deepEqual(requestBody.system, [
      { type: "text", text: "Be concise." },
    ]);
    assert.deepEqual(requestBody.messages, [
      { role: "user", content: "Hello" },
    ]);

    assert.deepEqual(seen, [
      "start",
      "text_start",
      "text_delta",
      "text_end",
      "done",
    ]);

    assert.equal(result.responseId, "msg_1");
    assert.deepEqual(result.content, [{ type: "text", text: "Hi" }]);
    assert.equal(result.stopReason, "stop");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
