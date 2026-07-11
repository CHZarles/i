import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeSseLine,
  type SseDecoderState,
} from "../src/api/anthropic-messages.ts";

test("decodeSseLine builds one Anthropic SSE frame", () => {
  const state: SseDecoderState = {
    event: null,
    data: [],
    raw: [],
  };

  assert.equal(decodeSseLine("event: message_start", state), null);
  assert.equal(decodeSseLine('data: {"type":"message_start"}', state), null);

  assert.deepEqual(decodeSseLine("", state), {
    event: "message_start",
    data: '{"type":"message_start"}',
    raw: ["event: message_start", 'data: {"type":"message_start"}'],
  });

  assert.deepEqual(state, {
    event: null,
    data: [],
    raw: [],
  });
});

test("decodeSseLine assembles consecutive Anthropic response events", () => {
  const state: SseDecoderState = {
    event: null,
    data: [],
    raw: [],
  };

  // 模拟网络读取器已经把响应字节切成一行一行后，依次交给解码器。
  const lines = [
    "event: message_start",
    'data: {"type":"message_start","message":{"id":"msg_1"}}',
    "",
    "event: content_block_delta",
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}',
    "",
  ];

  const frames = [];

  for (const line of lines) {
    const frame = decodeSseLine(line, state);
    if (frame) frames.push(frame);
  }

  assert.deepEqual(
    frames.map((frame) => frame.event),
    ["message_start", "content_block_delta"],
  );

  // 完成 SSE 分帧后，下一层才会解析每个 data JSON 字符串。
  assert.deepEqual(
    frames.map((frame) => JSON.parse(frame.data).type),
    ["message_start", "content_block_delta"],
  );
});
