type OpenAIConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export async function callOpenAI(config: OpenAIConfig, prompt: string) {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/responses`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      input: prompt,
    }),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const data = await res.json();
  return data.output
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("");
}
