import { openaiProvider } from "../src/providers/openai.ts";

const provider = openaiProvider();

console.log(provider.id);
console.log(provider.name);
console.log(provider.baseUrl);
console.log(provider.getModels()[0]?.id);
