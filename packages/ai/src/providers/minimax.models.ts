import type { Model } from "../types.ts";

export const MINIMAX_MODELS = {
  "MiniMax-M3": {
    id: "MiniMax-M3",
    name: "MiniMax-M3",
    api: "anthropic-messages",
    provider: "minimax",
    baseUrl: "https://api.minimax.io/anthropic",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1000000,
    maxTokens: 128000,
  } satisfies Model<"anthropic-messages">,
} as const;
