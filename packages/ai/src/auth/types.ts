import type { Api, Model, ProviderEnv, ProviderHeaders } from "../types.ts";

/**
 * Request auth for a single model request. If a value cannot be expressed as
 * `apiKey`, `headers`, or `baseUrl`, it is provider config, not auth.
 */
export interface ModelAuth {
  apiKey?: string;
  headers?: ProviderHeaders;
  baseUrl?: string;
}

/**
 * Stored api-key credential. `env` holds provider-scoped environment/config
 * values such as Cloudflare account/gateway ids.
 */
export interface ApiKeyCredential {
  type: "api_key";
  key?: string;
  env?: ProviderEnv;
}

/** Environment access for auth resolution. Injectable for tests and browsers. */
export interface AuthContext {
  env(name: string): Promise<string | undefined>;
}

/** Result of resolving auth for a model. */
export interface AuthResult {
  auth: ModelAuth;
  /** Provider-scoped environment/config values resolved from credentials and ambient context. */
  env?: ProviderEnv;
  /** Human-readable label for status UI: "ANTHROPIC_API_KEY",  "~/.aws/credentials". */
  source?: string;
}

export type AuthPrompt = {
  type: "secret";
  message: string;
};

/**
 * Login interaction callbacks serving api-key flows.
 *
 * `prompt()` returns the entered string. Rejects on cancel/abort.
 * The caller's outer AbortSignal aborts the whole login flow.
 */
export interface AuthLoginCallbacks {
  prompt(prompt: AuthPrompt): Promise<string>;
}

/**
 * Api-key auth: stored key/provider env plus ambient sources (env vars, AWS
 * profiles, ADC files). Ambient-only providers omit `login`.
 */
export interface ApiKeyAuth {
  /** Display name, e.g. "Anthropic API key". */
  name: string;

  /** Interactive setup (prompt for key/provider env). Absent = ambient-only. */
  login?(callbacks: AuthLoginCallbacks): Promise<ApiKeyCredential>;

  /**
   * Resolve auth from the stored credential and/or ambient sources, merging
   * per field (`credential.key ?? env("...")`, `credential.env?.NAME ?? env("...")`).
   * undefined = not configured. Receives the chat or image-generation model
   * the request is for (both carry `provider` and `baseUrl`).
   */
  resolve(input: {
    model: Model<Api>;
    ctx: AuthContext;
    credential?: ApiKeyCredential;
  }): Promise<AuthResult | undefined>;
}

/**
 * Provider auth. `apiKey` must be present: even
 * ambient-credential providers and keyless local servers provide `apiKey`
 * auth whose `resolve()` reports whether the provider is configured.
 */
export interface ProviderAuth {
  apiKey?: ApiKeyAuth;
}
