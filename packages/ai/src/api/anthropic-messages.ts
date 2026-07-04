type AnthropicMessagesConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens?: number;
};

export async function callAnthropicMessages(
  config: AnthropicMessagesConfig,
  prompt: string,
) {
  if (!config.apiKey) {
    throw new Error("No API key for provider");
  }

  const url = `${config.baseUrl.replace(/\/+$/, "")}/v1/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens ?? 1024,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const data = await res.json();

  return data.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}
