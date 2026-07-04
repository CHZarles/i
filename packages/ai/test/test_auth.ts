import { envApiKeyAuth } from "../src/auth/helpers.ts";

const auth = envApiKeyAuth("OpenAI API key", ["OPENAI_API_KEY"]);

const result = await auth.resolve({
  model: {
    id: "gpt-5.4-mini",
    name: "GPT",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: false,
    input: ["text"],
    contextWindow: 128000,
    maxTokens: 8192,
  },
  ctx: {
    env: async (name) => process.env[name],
  },
});

console.log(result);
