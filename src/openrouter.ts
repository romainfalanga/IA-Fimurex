// Client OpenRouter executant les appels au format OpenAI-compatible depuis
// l'environnement Cloudflare Workers.

export interface OpenRouterConfig {
  apiKey: string;
  baseUrl: string;
  modelVision: string;
  modelReasoning: string;
}

export interface ChatCall {
  model: string;
  system: string;
  user: string | Array<Record<string, unknown>>;
  jsonResponse?: boolean;
}

export async function chat(cfg: OpenRouterConfig, call: ChatCall): Promise<string> {
  if (!cfg.apiKey) throw new Error("OPENROUTER_API_KEY manquant");
  const payload: Record<string, unknown> = {
    model: call.model,
    temperature: 0,
    max_tokens: 16000,
    messages: [
      { role: "system", content: call.system },
      { role: "user", content: call.user },
    ],
  };
  if (call.jsonResponse) payload.response_format = { type: "json_object" };

  const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://fimurex-ia-agent.workers.dev",
      "X-Title": "Fimurex IA Agent",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter ${response.status} : ${text}`);
  }
  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0].message.content;
}

export function parseJson<T = unknown>(raw: string): T {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/```\s*$/, "").trim();
  }
  return JSON.parse(text) as T;
}
