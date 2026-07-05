import type { ProviderStreams } from "../types.ts";
import * as openAIResponses from "./openai-responses.ts";

export const openAIResponsesApi = (): ProviderStreams => openAIResponses;
