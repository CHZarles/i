import { envApiKeyAuth } from "../src/auth/helpers.ts";
import { createProvider } from "../src/models.ts";

const provider = createProvider({
  id: "openai",
  name: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  auth: {
    apiKey: envApiKeyAuth("OpenAI API key", ["OPENAI_API_KEY"]),
  },
  models: [
    {
      id: "gpt-5.4-mini",
      name: "GPT 5.4 mini",
      api: "openai-responses",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 8192,
    },
  ],
});

console.log(provider.id);
console.log(provider.getModels()[0]?.id);
