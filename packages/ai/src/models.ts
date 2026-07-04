import type { Api, Model, ProviderHeaders } from "./types.ts";
import type { ProviderAuth } from "./auth/types.ts";

export interface Provider<TApi extends Api = Api> {
  readonly id: string;
  readonly name: string;

  readonly baseUrl?: string;
  readonly headers?: ProviderHeaders;
  readonly auth: ProviderAuth;

  /**
   * Current known models, sync. Static providers return their catalog;
   * (empty before the first). Must not throw; `Models` treats a throwing
   * implementation as having no models.
   */
  getModels(): readonly Model<TApi>[];
}

export interface CreateProviderOptions<TApi extends Api = Api> {
  id: string;
  /** Display name. Default: `id`. */
  name?: string;
  baseUrl?: string;
  headers?: ProviderHeaders;
  /** Required — every provider has auth semantics, even ambient/keyless ones. */
  auth: ProviderAuth;
  /** Initial model list (empty for purely dynamic providers). */
  models: readonly Model<TApi>[];
}

export function createProvider<TApi extends Api = Api>(
  input: CreateProviderOptions<TApi>,
): Provider<TApi> {
  return {
    id: input.id,
    name: input.name ?? input.id,
    baseUrl: input.baseUrl,
    headers: input.headers,
    auth: input.auth,
    getModels: () => input.models,
  };
}
