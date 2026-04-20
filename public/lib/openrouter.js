// Client OpenRouter appele directement depuis le navigateur.
// Cote 100% client : aucun Worker intermediaire, donc aucune limite de
// sous-requetes Cloudflare. La cle API reste chez l'utilisateur.

export const MODEL = "google/gemini-2.0-flash-001";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export async function chat({ apiKey, system, user, jsonResponse = false }) {
  if (!apiKey) throw new Error("Cle OpenRouter manquante");

  const body = {
    model: MODEL,
    temperature: 0,
    max_tokens: 16000,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (jsonResponse) body.response_format = { type: "json_object" };

  const resp = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": location.origin,
      "X-Title": "Fimurex IA Agent",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenRouter ${resp.status} : ${text}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? "";
}

export function parseJson(raw) {
  let text = String(raw).trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/```\s*$/, "").trim();
  }
  return JSON.parse(text);
}
