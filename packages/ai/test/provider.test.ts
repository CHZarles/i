import test from "node:test";
import assert from "node:assert/strict";

import { openaiProvider } from "../src/providers/openai.ts";
import { minimaxProvider } from "../src/providers/minimax.ts";

// Provider owns model catalog, auth strategy, and adapter wiring
// because different companies expose different model lists,
// credentials, base URLs, and API shapes, and provider is the layer
// that packages those differences behind one common Provider object.
test("openaiProvider exposes model catalog and auth", async () => {
  const provider = openaiProvider();
  const model = provider.getModels()[0];

  assert.equal(provider.id, "openai");
  assert.equal(provider.name, "OpenAI");
  assert.equal(provider.baseUrl, "https://api.openai.com/v1");

  assert.ok(model);
  assert.equal(model.api, "openai-responses");
  assert.equal(model.provider, "openai");

  const auth = await provider.auth.apiKey?.resolve({
    model,
    ctx: {
      env: async (name) =>
        name === "OPENAI_API_KEY" ? "openai-key" : undefined,
    },
  });

  assert.equal(auth?.auth.apiKey, "openai-key");
  assert.equal(auth?.source, "OPENAI_API_KEY");
});

test("minimaxProvider exposes Anthropic-style model catalog and auth", async () => {
  const provider = minimaxProvider();
  const model = provider.getModels()[0];
  assert.equal(provider.id, "minimax");
  assert.equal(provider.name, "MiniMax");
  assert.equal(provider.baseUrl, "https://api.minimax.io/anthropic");

  assert.ok(model);
  assert.equal(model.api, "anthropic-messages");
  assert.equal(model.provider, "minimax");

  const auth = await provider.auth.apiKey?.resolve({
    model,
    ctx: {
      env: async (name) =>
        name === "MINIMAX_API_KEY" ? "minimax-key" : undefined,
    },
  });

  assert.equal(auth?.auth.apiKey, "minimax-key");
  assert.equal(auth?.source, "MINIMAX_API_KEY");
});
