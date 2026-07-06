import type { AssistantMessage, AssistantMessageEvent } from "../types.ts";

// 定义一个事件流类。
// T 表示“流里每次吐出来的事件类型”。
// R 表示“整个流最终返回的结果类型”。
// R = T 表示：如果不特别指定 R，那最终结果类型默认和事件类型一样。
//
// implements AsyncIterable<T> 表示：
// 这个类可以被 `for await ... of` 这种语法异步遍历
export class EventStream<T, R = T> implements AsyncIterable<T> {
  // 已经 push 进来、但还没有被 for await 读走的事件。
  //
  // 在 AssistantMessageEventStream 里，T 就是 AssistantMessageEvent，
  // 所以这里实际存的是：
  // [
  //   { type: "start", partial: ... },
  //   { type: "done", reason: "stop", message: ... }
  private queue: T[] = [];

  // 正在等待下一个事件的读取者。
  //
  // 如果调用方已经执行到 for await，正在等下一个 event，
  // 但此时还没人 push 事件进来，
  // 就把“唤醒这个读取者的函数”存在 waiting 里。
  //
  // 正常设计里，一个 EventStream 应该只被一个消费者读取。
  //
  // 这里用数组不是表示它支持广播；
  // 多个消费者同时读同一个 stream 会竞争事件，导致每个人只读到一部分。
  // 数组只是为了在误用或复杂场景下，end() 能唤醒所有等待者，避免挂死。
  private waiting: ((value: IteratorResult<T>) => void)[] = [];

  // 流是否已经结束。
  // 结束后再 push 新事件会被忽略。
  private done = false;

  // 给外部等待“最终结果”用的 Promise。
  // 它一开始是 pending 状态，还没有结果。
  //
  // 外部调用：
  // await stream.result()
  //
  // 本质上就是在等这个 Promise 被 resolve。
  // 对 AssistantMessageEventStream 来说，R 就是 AssistantMessage。
  private finalResultPromise: Promise<R>;

  // 用来完成 finalResultPromise 的函数。
  //
  // new Promise((resolve) => { ... }) 会给我们这个 resolve 函数。
  // 这里先把它存起来，等后面真的拿到最终结果时再调用：
  //
  // this.resolveFinalResult(result)
  //
  // 一旦调用，所有 await stream.result() 的地方都会拿到 result。
  private resolveFinalResult!: (result: R) => void;

  // 判断一个事件是不是“最终事件”。
  //
  // T 是事件类型。对 AssistantMessageEventStream 来说，T 是：
  // { type: "start", ... }
  // { type: "done", ... }
  // { type: "error", ... }
  //
  // 其中 done/error 表示流已经有最终结果了。
  private isComplete: (event: T) => boolean;

  // 从“最终事件”里取出最终结果。
  //
  // 对 AssistantMessageEventStream 来说：
  // done 事件里取 event.message；
  // error 事件里取 event.error。
  //
  // 取出来的值类型是 R，也就是 stream.result() 最后返回的东西。
  private extractResult: (event: T) => R;

  constructor(
    isComplete: (event: T) => boolean,
    extractResult: (event: T) => R,
  ) {
    // 把外部传进来的“结束判断规则”保存起来，
    // 后面 push(event) 时会用它判断这个事件是不是结束事件。
    this.isComplete = isComplete;

    // 把外部传进来的“最终结果提取规则”保存起来，
    // 后面遇到结束事件时，用它从 event 中取出最终结果。
    this.extractResult = extractResult;

    // 创建一个 Promise，用来表示“未来的最终结果”。
    // new Promise 会立刻给我们一个 resolve 函数。
    //
    // resolve 是 JS Promise 机制提供的函数：
    // 调用 resolve(result)，就表示这个 Promise 成功完成，值是 result。
    //
    // 这里暂时还没有最终结果，不能马上 resolve。
    // 所以先把 resolve 保存到 this.resolveFinalResult，
    // 等后面收到 done/error 事件时再调用。
    this.finalResultPromise = new Promise((resolve) => {
      this.resolveFinalResult = resolve;
    });
  }

  push(event: T): void {
    if (this.done) return;

    // 如果当前事件是结束事件，比如 done/error，
    // 说明最终结果已经出现了。
    //
    // extractResult(event) 从这个事件里取出最终结果 R。
    // resolveFinalResult(result) 会完成 finalResultPromise。
    //
    // 于是外部之前写的：
    // await stream.result()
    //
    // 就会恢复执行，并拿到这个 result。
    if (this.isComplete(event)) {
      this.done = true;
      this.resolveFinalResult(this.extractResult(event));
    }

    // 取出最早等待事件的消费者。
    // 如果有人已经在 for await 里等事件，waiting 里就会有一个 waiter。
    const waiter = this.waiting.shift();
    if (waiter) {
      // 有人在等：直接把当前 event 交给他。
      // done: false 表示这是一条正常事件，不是结束信号。
      waiter({ value: event, done: false });
    } else {
      // 没人在等：把 event 暂存在 queue 里。
      // 之后消费者 for await 时会从 queue 取走。
      this.queue.push(event);
    }
  }

  // 结束这个流，并唤醒所有正在等待事件的人
  end(result?: R): void {
    this.done = true;

    // 如果调用 end() 时传了最终结果，
    // 就完成 finalResultPromise。
    // 这样 await stream.result() 的地方可以拿到 result。
    if (result !== undefined) this.resolveFinalResult(result);

    // 可能有多个消费者正在等待下一个事件。
    // 流结束了，要把他们全部唤醒。
    while (this.waiting.length > 0) {
      // ! 表示告诉 TypeScript：这里一定不是 undefined，因为 while 已经确认 length > 0。
      const waiter = this.waiting.shift()!;

      // 告诉等待者：没有更多事件了，迭代结束。
      // done: true 是结束信号。
      // value 不会被使用，只是为了满足类型。
      waiter({ value: undefined as T, done: true });
    }
  }

  // 定义这个流如何被 for await 读取。
  // 消费者调用：
  // for await (const event of stream) { ... }
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      // 情况 1：事件已经提前 push 进 queue。
      // 直接从 queue 里取出最早的事件，交给消费者。
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.done) {
        return;
      } else {
        // 情况 3：queue 没有事件，但流还没结束。
        // 消费者需要等待未来的 push(event)。
        //   创建一个 Promise，把它的 resolve 放进 waiting。
        //
        // 之后 push(event) 会取出这个 resolve，并调用：
        // waiter({ value: event, done: false })
        //
        // 这样这里的 await 就会恢复执行，拿到 result。
        const result = await new Promise<IteratorResult<T>>((resolve) =>
          this.waiting.push(resolve),
        );

        // 如果 end() 唤醒了这个等待者，会传 done: true。
        // 表示流结束，不再 yield 事件。
        if (result.done) return;

        // 如果 push(event) 唤醒了这个等待者，
        // result.value 就是那个 event。
        yield result.value;
      }
    }
  }

  // 返回整个流的最终结果。
  // 它不会消费 queue，也不会读取每个事件。
  //
  // for await 用来读过程事件：
  // start / done / error
  //
  // result() 用来等最终结果 R。
  //
  // 对 AssistantMessageEventStream 来说：
  // R 是 AssistantMessage，
  // 所以 await stream.result() 拿到的是最终 assistant 消息。
  result(): Promise<R> {
    return this.finalResultPromise;
  }
}

// Assistant 专用事件流。
// 它把通用 EventStream<T, R> 固定成：
//
// T = AssistantMessageEvent
//     也就是 start / done / error 这些事件对象
//     e.g { type: "start"; partial: AssistantMessage }
//
// R = AssistantMessage
//     也就是整个流最终产出的 assistant 消息
export class AssistantMessageEventStream extends EventStream<
  AssistantMessageEvent,
  AssistantMessage
> {
  constructor() {
    // 调用父类 EventStream 的 constructor。
    //
    // 父类需要两个规则：
    // 1. 怎么判断某个事件是不是最终事件
    // 2. 如果是最终事件，怎么从里面取最终结果
    super(
      // 规则 1：
      // done 表示正常完成；
      // error 表示异常完成；
      // 两者都代表这个 assistant 流已经有最终结果了。
      (event) => event.type === "done" || event.type === "error",

      // 规则 2：
      // 从最终事件里取出最终 AssistantMessage。
      (event) => {
        // 正常结束时，最终消息在 event.message。
        if (event.type === "done") return event.message;

        // 异常结束时，错误消息也用 AssistantMessage 表示，
        // 放在 event.error。
        if (event.type === "error") return event.error;

        // 理论上不会走到这里。
        // 因为只有 done/error 才会触发 extractResult。
        throw new Error("Unexpected event type for final result");
      },
    );
  }
}
