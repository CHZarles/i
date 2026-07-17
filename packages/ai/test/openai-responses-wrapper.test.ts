import test from "node:test";
import assert from "node:assert/strict";

import { streamSimple } from "../src/api/openai-responses.ts";
import type { Context, Model } from "../src/types.ts";

const model: Model<"openai-responses"> = {
  id: "gpt-test",
  name: "GPT Test",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  reasoning: false,
  input: ["text"],
  contextWindow: 128000,
  maxTokens: 8192,
};

function sseResponse(events: unknown[]): Response {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");

  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}
test("streamSimple sends OpenAI Responses request and returns assistant message", async () => {
  const context: Context = {
    systemPrompt: "Be concise.",
    messages: [{ role: "user", content: "Hello", timestamp: 1 }],
  };

  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  try {
    globalThis.fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;

      return sseResponse([
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "message" },
        },
        { type: "response.output_text.delta", output_index: 0, delta: "Hel" },
        { type: "response.output_text.delta", output_index: 0, delta: "lo" },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: {
            type: "message",
            content: [{ type: "output_text", text: "Hello" }],
          },
        },
        {
          type: "response.completed",
          response: {
            id: "resp_123",
            status: "completed",
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          },
        },
      ]);
    };

    const stream = streamSimple(model, context, { apiKey: "test-key" });
    const seen: string[] = [];
    const reader = (async () => {
      for await (const event of stream) {
        seen.push(event.type);
      }
    })();
    const result = await stream.result();
    await reader;
    assert.equal(capturedUrl, "https://api.openai.com/v1/responses");
    assert.equal(capturedInit?.method, "POST");

    const headers = new Headers(capturedInit?.headers);
    assert.equal(headers.get("authorization"), "Bearer test-key");
    assert.equal(headers.get("content-type"), "application/json");

    const requestBody = JSON.parse(String(capturedInit?.body));
    assert.equal(requestBody.model, "gpt-test");
    assert.equal(requestBody.stream, true);
    assert.deepEqual(requestBody.input, [
      { role: "system", content: "Be concise." },
      { role: "user", content: [{ type: "input_text", text: "Hello" }] },
    ]);

    assert.deepEqual(seen, [
      "start",
      "text_start",
      "text_delta",
      "text_delta",
      "text_end",
      "done",
    ]);

    assert.equal(result.content[0]?.type, "text");
    assert.equal(result.content[0]?.text, "Hello");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
