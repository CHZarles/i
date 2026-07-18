import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Message,
  Model,
  SimpleStreamOptions,
  Tool,
} from "../../ai/src/types.ts";
import type { AssistantMessageEventStream } from "../../ai/src/utils/event-stream.ts";

// Agent loop 不直接依赖某个 provider。
// 它只需要一个“会调用模型并返回 AssistantMessageEventStream”的函数。
//
// 运行时形状：
//   streamFn(model, context, options?) -> AssistantMessageEventStream
//
// 现在测试里用 fake streamFn；以后可以传入 Models.streamSimple。
export type StreamFn = (
  model: Model,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

// 先复用 ai 包里的 Message 协议。
// 后续 session/harness 可能会扩展更多内部消息类型，
// 到那时再把 AgentMessage 和 provider Message 分开。
export type AgentMessage = Message;

// Tool 只描述“模型能调用什么”和“参数长什么样”。
// AgentTool 在 Tool 的基础上增加 execute，表示本地运行时真正会执行的函数。
export interface AgentTool extends Tool {
  execute(args: Record<string, unknown>): Promise<unknown> | unknown;
}

// Agent loop 当前回合可见的上下文：
// - systemPrompt: 系统提示词
// - messages: 当前对话历史
// - tools: 本轮允许模型调用的本地工具
export interface AgentContext {
  systemPrompt?: string;
  messages: AgentMessage[];
  tools?: AgentTool[];
}

// Agent loop 的固定配置。
// model + streamFn 决定“调用哪个模型、怎么调用”。
// maxTurns 是保护阀，防止模型一直要求工具、循环不结束。
export interface AgentLoopConfig {
  model: Model;
  streamFn: StreamFn;
  maxTurns?: number;
}

// AgentEvent 是 loop 对外发出的运行过程事件。
// 它不是 provider SSE；它是 Pi runtime 自己的生命周期事件。
//
// 典型顺序：
//   turn_start
//   message_start / message_delta* / message_end
//   tool_start / tool_end
//   turn_end
//   agent_end
export type AgentEvent =
  | { type: "turn_start" }
  | { type: "message_start"; message: Message }
  | { type: "message_delta"; event: AssistantMessageEvent }
  | { type: "message_end"; message: Message }
  | { type: "tool_start"; toolName: string; toolCallId: string }
  | { type: "tool_end"; message: Message }
  | { type: "turn_end"; message: AssistantMessage }
  | { type: "agent_end"; messages: Message[] };

// emit 是事件出口。
// UI、测试、日志、后续 Harness 都可以通过这个函数观察 loop 的运行过程。
// 返回 Promise 是为了允许异步订阅者，比如持久化或远程转发。
export type AgentEventSink = (event: AgentEvent) => void | Promise<void>;
