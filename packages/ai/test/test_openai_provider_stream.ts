import { config } from "dotenv";
import { openaiProvider } from "../src/providers/openai.ts";
import type { TextContent } from "../src/types.ts";

config({ override: true });

async function main() {
  const provider = openaiProvider();
  const model = provider.getModels()[0];
  if (!model) throw new Error("No model");

  const requestModel = {
    ...model,
    baseUrl: process.env.OPENAI_BASE_URL ?? model.baseUrl,
  };

  const message = await provider
    .streamSimple(
      requestModel,
      {
        systemPrompt:
          "You are a precise memory test. Reply with only the requested token.",
        messages: [
          {
            role: "user",
            content: "Remember this token: ctx-charles-7319.",
            timestamp: Date.now(),
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "OK" }],
            api: requestModel.api,
            provider: requestModel.provider,
            model: requestModel.id,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            stopReason: "stop",
            timestamp: Date.now(),
          },
          {
            role: "user",
            content: "What token did I ask you to remember?",
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: process.env.OPENAI_API_KEY,
        maxTokens: 32,
      },
    )
    .result();

  if (message.stopReason !== "stop") throw new Error(message.errorMessage);

  const text = message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("");
  if (!text.includes("ctx-charles-7319")) {
    throw new Error(`Expected model to use conversation history, got: ${text}`);
  }

  console.log(text);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
