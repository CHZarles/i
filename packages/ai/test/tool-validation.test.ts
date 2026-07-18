import test from "node:test";
import assert from "node:assert/strict";

import type { Tool, ToolCall } from "../src/types.ts";
import { validateToolCall } from "../src/utils/validation.ts";
import { createToolResultMessage } from "../src/utils/tool-results.ts";

/*
 定义一个假工具 get_weather，schema 规定：

必填 city(string)、days(integer)
可选 units(string)
后面所有测试都拿这个 tools 当规则来校验
*/
const tools: Tool[] = [
  {
    name: "get_weather",
    description: "Get weather",
    parameters: {
      type: "object",
      required: ["city", "days"],
      properties: {
        city: { type: "string" },
        days: { type: "integer" },
        units: { type: "string" },
      },
    },
  },
];

test("validateToolCall rejects unknown tool", () => {
  assert.throws(
    () =>
      validateToolCall(tools, {
        type: "toolCall",
        id: "call_1",
        name: "missing",
        arguments: {},
      }),
    /Tool "missing" not found/,
  );
});

test("validateToolCall rejects missing required argument", () => {
  assert.throws(
    () =>
      validateToolCall(tools, {
        type: "toolCall",
        id: "call_1",
        name: "get_weather",
        arguments: { city: "SF" },
      }),
    /arguments.days: required/,
  );
});

test("validateToolCall rejects wrong argument type", () => {
  assert.throws(
    () =>
      validateToolCall(tools, {
        type: "toolCall",
        id: "call_1",
        name: "get_weather",
        arguments: { city: "SF", days: "3" },
      }),
    /arguments.days: expected integer/,
  );
});

test("validateToolCall returns cloned valid arguments", () => {
  const toolCall: ToolCall = {
    type: "toolCall",
    id: "call_1",
    name: "get_weather",
    arguments: { city: "SF", days: 3 },
  };

  const args = validateToolCall(tools, toolCall);

  assert.deepEqual(args, { city: "SF", days: 3 });
  assert.notEqual(args, toolCall.arguments);
});

test("createToolResultMessage creates a toolResult transcript message", () => {
  const message = createToolResultMessage(
    {
      type: "toolCall",
      id: "call_1",
      name: "get_weather",
      arguments: { city: "SF" },
    },
    { temperature: 18 },
  );

  assert.equal(message.role, "toolResult");
  assert.equal(message.toolCallId, "call_1");
  assert.equal(message.toolName, "get_weather");
  assert.equal(message.isError, false);
  assert.deepEqual(message.content, [
    { type: "text", text: '{"temperature":18}' },
  ]);
});
