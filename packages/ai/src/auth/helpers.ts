import type { ApiKeyAuth } from "./types.ts";
/*
     resolve({ credential, ctx })
       |
       v
  credential?.key 有吗？
       |
    +--+--+
    |     |
   yes    no
    |     |
    v     v
  用它   ctx.env("OPENAI_API_KEY")
    |          |
    |       +--+--+
    |       |     |
    |      有值   没值
    |       |     |
    v       v     v
  AuthResult     undefined
  {
    auth: { apiKey },
    source: "stored credential" 或 "OPENAI_API_KEY"
  }
 */

/**
 * 创建一个标准的 API-key 鉴权方案。
 *
 * 这个函数本身不做请求，它返回一个符合 ApiKeyAuth 接口的对象：
 * {
 *   name,
 *   login,
 *   resolve
 * }
 */
export function envApiKeyAuth(
  // 展示名，也会用于登录提示文案。
  // 例如 "OpenAI API key"。
  name: string,

  // 按顺序尝试读取的环境变量名。
  // readonly 表示这个函数只读这个数组，不修改它。
  // 例如 ["OPENAI_API_KEY"]。
  envVars: readonly string[],
): ApiKeyAuth {
  return {
    // 对象属性简写。
    // 等价于：name: name
    name,

    // login 是 ApiKeyAuth 里的可选方法。
    // 根据定义 callbacks 类型是 AuthLoginCallbacks
    login: async (callbacks) => {
      // callbacks.prompt(...) 会向外部 UI/CLI 请求用户输入。
      const key = await callbacks.prompt({
        type: "secret",
        message: `Enter ${name}`,
      });

      // 返回保存用的 credential。
      return { type: "api_key", key };
    },

    // resolve 是 ApiKeyAuth 的核心方法。
    // 这里直接从参数对象里取 ctx 和 credential。
    // model 没写，是因为这个标准 api-key helper 不需要 model。
    resolve: async ({ ctx, credential }) => {
      // 优先使用已经保存的 credential.key。
      // - credential?.key 是可选链
      if (credential?.key)
        return {
          // AuthResult.auth，最终请求层可直接使用的鉴权信息。
          auth: { apiKey: credential.key },
          // source 只是给 UI/日志看的来源说明。
          source: "stored credential",
        };

      // 如果没有 stored key，就按顺序尝试环境变量。
      for (const envVar of envVars) {
        // 通过 AuthContext 读取环境变量/外部配置。
        const value = await ctx.env(envVar);

        // 如果读到了值，就返回 AuthResult。
        if (value) return { auth: { apiKey: value }, source: envVar };
      }

      // stored credential 没有 key，
      // envVars 也都没读到值，
      // 说明当前 provider 没配置好。
      return undefined;
    },
  };
}
