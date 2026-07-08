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

      return new Response(
        JSON.stringify({
          id: "resp_123",
          output_text: "Hello from OpenAI",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
          },
        }),
        { status: 200 },
      );
    };

    const stream = streamSimple(model, context, { apiKey: "test-key" });
    const result = await stream.result();

    assert.equal(capturedUrl, "https://api.openai.com/v1/responses");
    assert.equal(capturedInit?.method, "POST");

    const headers = capturedInit?.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer test-key");
    assert.equal(headers["content-type"], "application/json");

    const body = JSON.parse(String(capturedInit?.body));
    assert.equal(body.model, "gpt-test");
    assert.deepEqual(body.input, [
      { role: "system", content: "Be concise." },
      { role: "user", content: [{ type: "input_text", text: "Hello" }] },
    ]);

    assert.equal(result.content[0]?.type, "text");
    assert.equal(result.content[0]?.text, "Hello from OpenAI");
    assert.equal(result.responseId, "resp_123");
    assert.equal(result.usage.input, 10);
    assert.equal(result.usage.output, 5);
    assert.equal(result.usage.totalTokens, 15);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
