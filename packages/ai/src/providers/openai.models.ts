import type { Model } from "../types.ts";

export const OPENAI_MODELS = {
  "gpt-5.4-mini": {
    id: "gpt-5.4-mini",
    name: "GPT 5.4 mini",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: false,
    input: ["text"],
    contextWindow: 128000,
    maxTokens: 8192,
  } satisfies Model<"openai-responses">,
} as const;
