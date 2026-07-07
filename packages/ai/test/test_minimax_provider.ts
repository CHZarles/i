import { minimaxProvider } from "../src/providers/minimax.ts";
import assert from "node:assert/strict";

const provider = minimaxProvider();
const model = provider.getModels()[0]!;

console.log(provider.id);
console.log(provider.name);
console.log(provider.baseUrl);
console.log(model.id);
console.log(model.api);
console.log(model.provider);

const auth = await provider.auth.apiKey?.resolve({
  model,
  ctx: {
    env: async (name) => process.env[name],
  },
});

console.log(auth?.source);

const message = await provider
  .streamSimple(
    model,
    {
      messages: [
        {
          role: "user",
          content: "Say hi",
          timestamp: Date.now(),
        },
      ],
    },
    {},
  )
  .result();

assert.equal(message.stopReason, "error");
assert.match(message.errorMessage ?? "", /No API key/);
