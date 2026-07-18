import test from "node:test";
import assert from "node:assert/strict";

import type { AssistantMessage, Message, Context } from "../src/types.ts";
import { buildParams, convertMessages } from "../src/api/anthropic-messages.ts";

import { minimaxProvider } from "../src/providers/minimax.ts";
const assistant: AssistantMessage = {
  role: "assistant",
  content: [{ type: "text", text: "Hi there" }],
  api: "anthropic-messages",
  provider: "minimax",
  model: "MiniMax-M3",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  },
  stopReason: "stop",
  timestamp: 1,
};

test("converts Pi messages into Anthropic messages", () => {
  const messages: Message[] = [
    { role: "user", content: "Hello", timestamp: 1 },
    assistant,
  ];

  assert.deepEqual(convertMessages(messages), [
    { role: "user", content: "Hello" },
    {
      role: "assistant",
      content: [{ type: "text", text: "Hi there" }],
    },
  ]);
});

test("convertMessages replays Anthropic tool call and tool result", () => {
  const messages: Message[] = [
    { role: "user", content: "Weather in SF?", timestamp: 1 },
    {
      ...assistant,
      content: [
        {
          type: "toolCall",
          id: "call_1",
          name: "get_weather",
          arguments: { city: "SF" },
        },
      ],
      stopReason: "toolUse",
    },
    {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "get_weather",
      content: [{ type: "text", text: '{"temperature":18}' }],
      isError: false,
      timestamp: 2,
    },
  ];

  assert.deepEqual(convertMessages(messages), [
    { role: "user", content: "Weather in SF?" },
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call_1",
          name: "get_weather",
          input: { city: "SF" },
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "call_1",
          content: '{"temperature":18}',
          is_error: false,
        },
      ],
    },
  ]);
});

test("builds MiniMax Anthropic request parameters", () => {
  const model = minimaxProvider().getModels()[0];
  assert.ok(model);

  const context: Context = {
    systemPrompt: "Be concise.",
    messages: [{ role: "user", content: "Hello", timestamp: 1 }, assistant],
  };

  assert.deepEqual(buildParams(model, context, { maxTokens: 64 }), {
    model: "MiniMax-M3",
    messages: [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: [{ type: "text", text: "Hi there" }],
      },
    ],
    max_tokens: 64,
    stream: true,
    system: [{ type: "text", text: "Be concise." }],
  });
});
