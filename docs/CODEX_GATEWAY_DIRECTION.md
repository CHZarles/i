# Codex Gateway Implementation Direction

## Goal

Support a custom gateway that internally routes requests to Codex accounts.

The local client should not perform ChatGPT OAuth itself. It should authenticate
to the gateway with a normal gateway API key, while the gateway owns Codex
account selection and upstream Codex credentials.

## Shape

```text
client
  -> codexGatewayProvider()
  -> gateway API key auth
  -> openai-codex-responses-style adapter
  -> custom gateway baseUrl
  -> gateway routes to internal Codex accounts
```

## Provider vs Adapter

`Provider` should describe the local integration:

- provider id, for example `codex-gateway`
- display name
- model list
- gateway `baseUrl`
- gateway API-key auth
- selected API adapter

The API adapter should describe the wire protocol:

- request body shape
- response parsing
- SSE/event handling
- reasoning/thinking options

## Do Not Copy Direct Codex OAuth As-Is

The `remake-pi/pi` `openai-codex` provider represents direct ChatGPT/Codex
OAuth:

```text
openaiCodexProvider()
  -> OAuth login
  -> ChatGPT access token
  -> https://chatgpt.com/backend-api
```

That does not match the gateway case. In the gateway case:

```text
codexGatewayProvider()
  -> gateway API key
  -> custom gateway baseUrl
```

## Minimal Faithful Path

1. Add shared thinking-level types:
   - `ThinkingLevel`
   - optional `Model.thinkingLevelMap`
   - optional `SimpleStreamOptions.reasoning`

2. Add a Codex-style adapter:
   - start from the `openai-codex-responses` shape
   - keep reasoning/thinking request support
   - keep custom `baseUrl` support

3. Make the adapter gateway-friendly:
   - do not require local ChatGPT OAuth
   - do not require extracting `chatgpt-account-id` from the local API key
   - send the gateway key as bearer auth
   - let the gateway handle Codex account routing

4. Add a custom provider:
   - `providers/codex-gateway.ts`
   - `providers/codex-gateway.models.ts`
   - env key such as `CODEX_GATEWAY_API_KEY`
   - base URL from model/provider config

## Non-Goal For Now

Do not add full direct `openai-codex` OAuth support until the project actually
needs local ChatGPT login, token refresh, and direct `chatgpt.com/backend-api`
calls.
