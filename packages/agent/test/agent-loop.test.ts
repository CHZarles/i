import test from "node:test";
import assert from "node:assert/strict";

import { runAgentLoop } from "../src/agent-loop.ts";
import type { AgentTool, StreamFn } from "../src/types.ts";
import type { AssistantMessage, Model } from "../../ai/src/types.ts";
import { AssistantMessageEventStream } from "../../ai/src/utils/event-stream.ts";

// 测试用 fake model。
// 这里不走真实 provider，只需要一个 Model 对象满足类型合同。
const model: Model<"openai-responses"> = {
  id: "fake",
  name: "Fake",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.com",
  reasoning: false,
  input: ["text"],
  contextWindow: 1000,
  maxTokens: 100,
};

// 构造一条完整 AssistantMessage。
// 测试里会构造两种 assistant：
//   1. stopReason = "toolUse"，content 里是 toolCall
//   2. stopReason = "stop"，content 里是最终文本
function assistant(
  content: AssistantMessage["content"],
  stopReason: "stop" | "toolUse",
): AssistantMessage {
  return {
    role: "assistant",
    content,
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
    stopReason,
    timestamp: 1,
  };
}

// 把一条 AssistantMessage 包装成一个已经完成的 AssistantMessageEventStream。
//
// Runtime shape:
//   start(partial message)
//   done(final message)
//
// reason 单独传入，是为了忠于 Pi 的事件协议：
// done.reason 只能是成功原因 "stop" | "toolUse"，
// 错误结束要走 error 事件，不能把 message.stopReason 原样塞进去。
function streamOf(
  message: AssistantMessage,
  reason: "stop" | "toolUse",
): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  stream.push({ type: "start", partial: message });
  stream.push({ type: "done", reason, message });
  return stream;
}

test("runAgentLoop executes a tool and continues to final text", async () => {
  // calls 用来模拟“模型第几次被调用”。
  // 第一次：模型要求工具。
  // 第二次：模型看到 toolResult 后给出最终文本。
  let calls = 0;

  const streamFn: StreamFn = (_model, context) => {
    calls += 1;

    if (calls === 1) {
      // 第一轮 fake model 返回 assistant(toolCall)。
      // 这表示模型没有最终回答，而是要求运行 get_weather。
      return streamOf(
        assistant(
          [
            {
              type: "toolCall",
              id: "call_1",
              name: "get_weather",
              arguments: { city: "SF" },
            },
          ],
          "toolUse",
        ),
        "toolUse",
      );
    }

    // 第二轮 fake model 应该能看到上一轮工具执行后的 toolResult。
    // 这个断言证明 agent loop 把工具结果追加进了 transcript。
    assert.equal(context.messages.at(-1)?.role, "toolResult");

    // 看到 toolResult 后，fake model 返回最终文本。
    return streamOf(
      assistant([{ type: "text", text: "SF is 18C." }], "stop"),
      "stop",
    );
  };

  // 本地工具定义。
  // parameters 是给 validateToolCall 用的参数契约；
  // execute 是 agent loop 真正会调用的本地函数。
  const tool: AgentTool = {
    name: "get_weather",
    description: "Get weather",
    parameters: {
      type: "object",
      required: ["city"],
      properties: { city: { type: "string" } },
    },
    execute: () => ({ temperature: 18 }),
  };

  // 初始 transcript 只有一条 user message。
  // runAgentLoop 会在这个基础上追加 assistant/toolResult/assistant。
  const messages = await runAgentLoop(
    {
      messages: [{ role: "user", content: "Weather in SF?", timestamp: 1 }],
      tools: [tool],
    },
    { model, streamFn },
  );

  // 两次模型调用说明 loop 完成了：
  // 第一次拿 toolCall，第二次拿最终回答。
  assert.equal(calls, 2);

  // 最终 transcript 的四个角色说明完整闭环成立：
  // user -> assistant(toolCall) -> toolResult -> assistant(final text)
  assert.deepEqual(
    messages.map((message) => message.role),
    ["user", "assistant", "toolResult", "assistant"],
  );
});
