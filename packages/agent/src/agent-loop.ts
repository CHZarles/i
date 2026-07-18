import type { AssistantMessage, ToolCall } from "../../ai/src/types.ts";
import { validateToolCall } from "../../ai/src/utils/validation.ts";
import { createToolResultMessage } from "../../ai/src/utils/tool-results.ts";
import type { AgentContext, AgentEventSink, AgentLoopConfig } from "./types.ts";

// 从一条 assistant 消息里找出所有工具调用 block。
//
// message.content 是混合数组：
//   [{ type: "text", ... }, { type: "toolCall", ... }]
//
// `block is ToolCall` 是 TypeScript 类型守卫：
// filter 后返回值会被收窄成 ToolCall[]，
// 后面就能安全访问 toolCall.name / toolCall.arguments。
function findToolCalls(message: AssistantMessage): ToolCall[] {
  return message.content.filter(
    (block): block is ToolCall => block.type === "toolCall",
  );
}

// 最小低层 agent loop。
//
// 它拥有一件事：把“模型回复 -> 工具执行 -> 继续请求模型”接成闭环。
//
// 当前最小运行路径：
//   1. 用 streamFn 请求模型
//   2. 收到 AssistantMessage
//   3. 如果没有 toolCall，结束并返回 transcript
//   4. 如果有 toolCall，校验参数、执行本地工具、追加 toolResult
//   5. 带着新 transcript 再请求模型
export async function runAgentLoop(
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink = () => {},
): Promise<AgentContext["messages"]> {
  // 复制一份 transcript，避免直接修改调用者传进来的 context.messages 数组。
  // loop 运行期间的新 assistant/toolResult 都追加到这个数组里。
  const messages = [...context.messages];

  // 没有传 tools 时，当作空工具集。
  // 如果模型之后要求不存在的工具，validateToolCall 会抛出清晰错误。
  const tools = context.tools ?? [];

  // 防止无限循环。
  // 例如模型每一轮都继续要求工具，永远不给最终文本。
  const maxTurns = config.maxTurns ?? 4;

  // 每次循环代表一次模型回合。
  // 一次回合可能产生最终文本，也可能产生 toolCall。
  for (let turn = 0; turn < maxTurns; turn += 1) {
    await emit({ type: "turn_start" });

    // 调用模型边界。
    // 注意 loop 不知道这是 OpenAI、MiniMax 还是 fake model；
    // 它只要求 streamFn 返回统一的 AssistantMessageEventStream。
    const stream = config.streamFn(config.model, {
      systemPrompt: context.systemPrompt,
      messages,
      tools,
    });

    // 当前模型回合最终产出的 assistant message。
    // 它会在 done 事件里出现；如果没有读到 done，就退回 stream.result()。
    let assistant: AssistantMessage | undefined;

    // 读取模型流事件。
    // start/delta/done 是 Pi 的统一事件协议，不是 HTTP SSE 原始文本。
    for await (const event of stream) {
      if (event.type === "start") {
        // 一条 assistant 消息开始生成。
        await emit({ type: "message_start", message: event.partial });
      } else if (event.type === "done") {
        // 成功结束。done.message 是这轮完整 assistant 消息。
        assistant = event.message;
      } else {
        // text_delta/toolcall_delta 等过程事件先统一转发出去。
        // 更细粒度的事件处理以后可以在这里补。
        await emit({ type: "message_delta", event });
      }
    }

    // 正常情况下 assistant 已经来自 done 事件。
    // 这行是兜底：如果 consumer 没在上面捕获 done，也能从 stream.result() 拿最终消息。
    assistant ??= await stream.result();

    // 把模型回复写入 transcript。
    // 后续如果有工具结果，下一次模型调用能看到这条 assistant(toolCall)。
    messages.push(assistant);
    await emit({ type: "message_end", message: assistant });

    // 检查模型是否要求本地工具。
    const toolCalls = findToolCalls(assistant);

    if (toolCalls.length === 0) {
      // 没有工具调用，说明这就是最终回答。
      await emit({ type: "turn_end", message: assistant });
      await emit({ type: "agent_end", messages });
      return messages;
    }

    // 当前先顺序执行工具。
    // 并行、before/after hook、terminate 等复杂行为留到后续切片。
    for (const toolCall of toolCalls) {
      const tool = tools.find((candidate) => candidate.name === toolCall.name);

      // 用工具 schema 校验模型给的 arguments。
      // 这里会同时检查工具是否存在、必填字段、字段类型。
      const args = validateToolCall(tools, toolCall);

      await emit({
        type: "tool_start",
        toolName: toolCall.name,
        toolCallId: toolCall.id,
      });

      // 执行本地工具。
      // validateToolCall 已经保证工具名存在；这里保持最小实现。
      const result = await tool?.execute(args);

      // 把本地函数返回值包装成 Pi transcript 里的 toolResult 消息。
      // 下一轮 streamFn 会把这条消息发回模型。
      const toolResult = createToolResultMessage(toolCall, result);

      messages.push(toolResult);
      await emit({ type: "tool_end", message: toolResult });
    }

    // 本轮结束，但因为有 toolResult，for 循环会进入下一轮继续请求模型。
    await emit({ type: "turn_end", message: assistant });
  }

  // 超过 maxTurns 仍没拿到最终回答，说明模型/工具循环没有收敛。
  throw new Error(`Agent loop exceeded ${maxTurns} turns`);
}
