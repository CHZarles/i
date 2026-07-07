import { openAIResponsesApi } from "../api/openai-responses.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { OPENAI_MODELS } from "./openai.models.ts";
/*
  openAIResponsesApi  -> stream implementation
  envApiKeyAuth       -> auth strategy
  createProvider      -> provider factory
  Provider            -> return type
  OPENAI_MODELS       -> model catalog
*/

// Build the OpenAI provider.
//
// This is a factory, not the provider object itself.
// Calling openaiProvider() returns a Provider<"openai-responses">.
export function openaiProvider(): Provider<"openai-responses"> {
  return createProvider({
    // Provider id.
    id: "openai",

    // Display name.
    name: "OpenAI",

    // Default OpenAI API base URL.
    baseUrl: "https://api.openai.com/v1",

    // Auth strategy.
    // Uses stored credential first, otherwise OPENAI_API_KEY.
    auth: {
      apiKey: envApiKeyAuth("OpenAI API key", ["OPENAI_API_KEY"]),
    },

    // Static model catalog converted from object to array.
    models: Object.values(OPENAI_MODELS),

    // API adapter: provides stream() and streamSimple().
    api: openAIResponsesApi(),
  });
}
