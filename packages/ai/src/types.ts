export type KnownApi = "openai-responses" | "anthropic-messages";
export type Api = KnownApi | (string & {});
export type ProviderEnv = Record<string, string>;
export type ProviderHeaders = Record<string, string | null>;
export type KnownProvider = "openai" | "minimax";
export type ProviderId = KnownProvider | (string & {});

// Model interface for the unified model system
export interface Model<TApi extends Api = Api> {
  id: string;
  name: string;
  api: TApi;
  provider: ProviderId;
  baseUrl: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  contextWindow: number;
  maxTokens: number;
}
