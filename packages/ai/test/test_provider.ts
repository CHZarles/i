import { config } from "dotenv";
import { callOpenAI } from "../src/providers/openai-responses.ts";
config({ override: true });
async function main() {
  // 你原来的 await 代码放这里
  const result = await callOpenAI(
    {
      apiKey: process.env.OPENAI_API_KEY!,
      baseUrl: process.env.OPENAI_BASE_URL!,
      model: "gpt-5.5",
    },
    "Say hi",
  );

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
