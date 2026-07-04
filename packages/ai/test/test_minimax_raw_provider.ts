import { config } from "dotenv";
import { callAnthropicMessages } from "../src/api/anthropic-messages.ts";

config({ override: true });

async function main() {
  const result = await callAnthropicMessages(
    {
      apiKey: process.env.MINIMAX_API_KEY!,
      baseUrl: process.env.MINIMAX_BASE_URL ?? "https://api.minimaxi.com/anthropic",
      model: "MiniMax-M3",
      maxTokens: 1024,
    },
    "Say hi",
  );

  console.log(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
