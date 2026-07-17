import test from "node:test";
import assert from "node:assert/strict";

import { convertResponsesMessages } from "../src/api/openai-responses-shared.ts";
import type { AssistantMessage, Context, Model } from "../src/types.ts";

const model: Model<"openai-responses"> = {
  id: "test-model",
  name: "Test Model",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  reasoning: false,
  input: ["text"],
  contextWindow: 128000,
  maxTokens: 8192,
};

const assistant: AssistantMessage = {
  role: "assistant",
  content: [{ type: "text", text: "Hi there" }],
  api: "openai-responses",
  provider: "openai",
  model: "test-model",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: 1,
};

test("convertResponsesMessages maps Pi context to OpenAI Responses input", () => {
  const context: Context = {
    systemPrompt: "Be concise.",
    messages: [{ role: "user", content: "Hello", timestamp: 1 }, assistant],
  };

  const input = convertResponsesMessages(model, context);

  assert.deepEqual(input, [
    { role: "system", content: "Be concise." },
    { role: "user", content: [{ type: "input_text", text: "Hello" }] },
    {
      type: "message",
      id: "msg_pi_1",
      role: "assistant",
      content: [{ type: "output_text", text: "Hi there", annotations: [] }],
      status: "completed",
    },
  ]);
});
