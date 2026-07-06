import type { Api, Model, ProviderEnv, ProviderHeaders } from "../types.ts";

// 1. 请求层 auth 结果
// resolve() 之后，真正交给请求层使用的数据。

// 单次请求最终可直接使用的鉴权信息。
// 不能表达成 apiKey / headers / baseUrl 的值，应放到 ProviderEnv。
export interface ModelAuth {
  apiKey?: string;
  headers?: ProviderHeaders;
  baseUrl?: string;
}

// resolve() 后的鉴权结果。
export interface AuthResult {
  auth: ModelAuth;
  env?: ProviderEnv;
  // 给 UI/日志看的来源，如 "OPENAI_API_KEY" 或 "stored credential"。
  source?: string;
}

// 2. 存储层 credential
// login() 后保存下来的东西；请求前还要经过 resolve()。

// 已存储的 api-key 凭据，通常来自 login()。
export interface ApiKeyCredential {
  type: "api_key";
  key?: string;
  env?: ProviderEnv;
}

// 3. 外部交互/环境抽象
// auth 层不绑定具体 UI、CLI、浏览器或 process.env。

// auth 解析时读取环境变量/外部配置的抽象入口。
export interface AuthContext {
  env(name: string): Promise<string | undefined>;
}

// login() 时向用户发起的输入请求。
export type AuthPrompt = {
  type: "secret";
  message: string;
};

// login() 与外部 UI/CLI 交互的回调。
export interface AuthLoginCallbacks {
  prompt(prompt: AuthPrompt): Promise<string>;
}

// 4. provider auth 策略
// provider 挂载策略，策略负责 login() 和请求前 resolve()。

// provider 的 api-key 鉴权方案：可选登录 + 请求前解析。
export interface ApiKeyAuth {
  name: string;

  // 可选交互式登录；ambient-only provider 可以不实现。
  login?(callbacks: AuthLoginCallbacks): Promise<ApiKeyCredential>;

  // 合并 credential、环境配置和当前模型信息，得到本次请求 auth。
  // 返回 undefined 表示未配置。
  resolve(input: {
    model: Model<Api>;
    ctx: AuthContext;
    credential?: ApiKeyCredential;
  }): Promise<AuthResult | undefined>;
}

// provider 级鉴权入口；当前只定义 apiKey 方案。
export interface ProviderAuth {
  apiKey?: ApiKeyAuth;
}
