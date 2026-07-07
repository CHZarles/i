import type { ProviderStreams } from "../types.ts";
import * as anthropicMessages from "./anthropic-messages.ts";

export const anthropicMessagesApi = (): ProviderStreams => anthropicMessages;
