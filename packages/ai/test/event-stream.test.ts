import test from "node:test";
import assert from "node:assert/strict";

import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import type { AssistantMessage } from "../src/types.ts";

function assistant(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
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
    stopReason: "stop", // means: “normal successful completion.”
    timestamp: Date.now(),
  };
}

test("AssistantMessageEventStream yields events and returns final message", async () => {
  const stream = new AssistantMessageEventStream();
  const partial = assistant("");
  const final = assistant("hello");

  const seen: string[] = [];

  async function readStream() {
    for await (const event of stream) {
      seen.push(event.type);
    }
  }

  const reader = readStream();

  stream.push({ type: "start", partial });
  stream.push({ type: "done", reason: "stop", message: final });
  stream.end(final);

  const result = await stream.result(); // block
  await reader; // blocks the current async test function until the reader task finishes.

  assert.deepEqual(seen, ["start", "done"]);
  assert.equal(result, final);
});
