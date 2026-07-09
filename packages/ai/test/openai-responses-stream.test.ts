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
    type: "response.output_item.done",
    output_index: 0,
    item: {
      type: "message",
      content: [{ type: "output_text", text: "Hello" }],
    },
  };
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

async function* failedEvents(): AsyncIterable<any> {
  yield {
    type: "response.failed",
    response: {
      error: { code: "server_error", message: "boom" },
    },
  };
}

test("processResponsesStream throws on OpenAI failed response", async () => {
  const output = createOutput();
  const stream = new AssistantMessageEventStream();

  await assert.rejects(
    processResponsesStream(failedEvents(), output, stream, model),
    /server_error: boom/,
  );
});

test("processResponsesStream emits text progress events", async () => {
  const output = createOutput();
  const stream = new AssistantMessageEventStream();
  const seen: string[] = [];

  // Start a consumer before parsing.
  // It observes live progress events pushed by processResponsesStream.
  const reader = (async () => {
    for await (const event of stream) {
      seen.push(event.type);
    }
  })();

  await processResponsesStream(events(), output, stream, model);

  // processResponsesStream handles provider events only.
  // The wrapper later owns done/error; the test ends the stream manually.
  stream.end(output);
  await reader;

  assert.deepEqual(seen, [
    "text_start",
    "text_delta",
    "text_delta",
    "text_end",
  ]);
});

async function* toolCallEvents(): AsyncIterable<any> {
  yield {
    type: "response.output_item.added",
    output_index: 0,
    item: {
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "get_weather",
      arguments: "",
    },
  };

  yield {
    type: "response.function_call_arguments.delta",
    output_index: 0,
    delta: '{"city"',
  };

  yield {
    type: "response.function_call_arguments.delta",
    output_index: 0,
    delta: ':"SF"}',
  };

  yield {
    type: "response.output_item.done",
    output_index: 0,
    item: {
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "get_weather",
      arguments: '{"city":"SF"}',
    },
  };

  yield {
    type: "response.completed",
    response: { id: "resp_tool", status: "completed" },
  };
}

test("processResponsesStream converts OpenAI function call into toolCall block", async () => {
  const output = createOutput();
  const stream = new AssistantMessageEventStream();

  await processResponsesStream(toolCallEvents(), output, stream, model);

  assert.deepEqual(output.content, [
    {
      type: "toolCall",
      id: "call_1|fc_1",
      name: "get_weather",
      arguments: { city: "SF" },
    },
  ]);
});

test("processResponsesStream emits tool call progress events", async () => {
  const output = createOutput();
  const stream = new AssistantMessageEventStream();
  const seen: string[] = [];

  const reader = (async () => {
    for await (const event of stream) {
      seen.push(event.type);
    }
  })();

  await processResponsesStream(toolCallEvents(), output, stream, model);

  stream.end(output);
  await reader;

  assert.deepEqual(seen, [
    "toolcall_start",
    "toolcall_delta",
    "toolcall_delta",
    "toolcall_end",
  ]);
});
