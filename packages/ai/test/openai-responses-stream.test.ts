import test from "node:test";
import assert from "node:assert/strict";

import { processResponsesStream } from "../src/api/openai-responses-shared.ts";
import type { AssistantMessage, Model } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

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

function createOutput(): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
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
}

async function* events(): AsyncIterable<any> {
  yield {
    type: "response.output_item.added",
    output_index: 0,
    item: { type: "message" },
  };

  yield { type: "response.output_text.delta", output_index: 0, delta: "Hel" };
  yield { type: "response.output_text.delta", output_index: 0, delta: "lo" };

  yield {
    type: "response.completed",
    response: {
      id: "resp_123",
      status: "completed",
      usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
    },
  };
}

test("processResponsesStream converts OpenAI text deltas into assistant text", async () => {
  const output = createOutput();
  const stream = new AssistantMessageEventStream();

  await processResponsesStream(events(), output, stream, model);

  assert.deepEqual(output.content, [{ type: "text", text: "Hello" }]);
  assert.equal(output.responseId, "resp_123");
  assert.equal(output.usage.input, 2);
  assert.equal(output.usage.output, 1);
  assert.equal(output.usage.totalTokens, 3);
  assert.equal(output.stopReason, "stop");
});
