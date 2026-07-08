import test from "node:test";
import assert from "node:assert/strict";

import { envApiKeyAuth } from "../src/auth/helpers.ts";
import type { Model } from "../src/types.ts";

const model: Model<"openai-responses"> = {
  id: "test-model",
  name: "Test Model",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  reasoning: false,
  input: ["text"],
  contextWindow: 128000,
  maxTokens: 8192,
};

test("envApiKeyAuth resolves an env key", async () => {
  // Concrete runtime objects
  const auth = envApiKeyAuth("OpenAI API key", ["OPENAI_API_KEY"]);

  // Convert possible credential sources into request-ready auth.
  const result = await auth.resolve({
    model,
    // if someone asks for OPENAI_API_KEY tnen return "env-key"
    ctx: {
      env: async (name) => (name === "OPENAI_API_KEY" ? "env-key" : undefined),
    },
  });

  assert.equal(result?.auth.apiKey, "env-key");
  assert.equal(result?.source, "OPENAI_API_KEY");
});

test("stored credential wins over env key", async () => {
  const auth = envApiKeyAuth("OpenAI API key", ["OPENAI_API_KEY"]);

  const result = await auth.resolve({
    model,
    credential: { type: "api_key", key: "stored-key" },
    ctx: {
      env: async () => "env-key",
    },
  });

  assert.equal(result?.auth.apiKey, "stored-key");
  assert.equal(result?.source, "stored credential");
});

test("missing credential and env returns undefined", async () => {
  const auth = envApiKeyAuth("OpenAI API key", ["OPENAI_API_KEY"]);

  const result = await auth.resolve({
    model,
    ctx: {
      env: async () => undefined,
    },
  });

  assert.equal(result, undefined);
});
