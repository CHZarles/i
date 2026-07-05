import { config } from "dotenv";
import { openaiProvider } from "../src/providers/openai.ts";

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
        messages: [
          {
            role: "user",
            content: "Say hi",
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: process.env.OPENAI_API_KEY,
      },
    )
    .result();

  console.log(message.content.map((part) => part.text).join(""));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
