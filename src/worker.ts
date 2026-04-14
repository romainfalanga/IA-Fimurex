// Fimurex AI Agent - Cloudflare Worker entrypoint.
// Sert le frontend (static assets) et expose l'API de traitement.

import { runPipeline, PipelineInput } from "./pipeline";
import type { OpenRouterConfig } from "./openrouter";

export interface Env {
  ASSETS: Fetcher;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL: string;
  MODEL_VISION: string;
  MODEL_REASONING: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-OpenRouter-Key",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ----- API -----
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }

    // ----- Static assets (frontend UI) -----
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/api/health") {
    return jsonResponse({ ok: true, version: "0.1.0" });
  }

  if (url.pathname === "/api/config") {
    return jsonResponse({
      modelVision: env.MODEL_VISION,
      modelReasoning: env.MODEL_REASONING,
      hasServerKey: Boolean(env.OPENROUTER_API_KEY),
    });
  }

  if (url.pathname === "/api/process" && request.method === "POST") {
    return handleProcess(request, env);
  }

  return errorResponse("Route inconnue", 404);
}

async function handleProcess(request: Request, env: Env): Promise<Response> {
  let payload: PipelineInput;
  try {
    payload = (await request.json()) as PipelineInput;
  } catch {
    return errorResponse("JSON invalide", 400);
  }
  if (!payload?.pages?.length) {
    return errorResponse("Aucune page fournie", 400);
  }

  const apiKey =
    request.headers.get("X-OpenRouter-Key") ??
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
    env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return errorResponse(
      "OPENROUTER_API_KEY manquant. Fournissez-la via l'en-tete X-OpenRouter-Key " +
        "ou definissez le secret OPENROUTER_API_KEY cote Worker.",
      401,
    );
  }

  const cfg: OpenRouterConfig = {
    apiKey,
    baseUrl: env.OPENROUTER_BASE_URL,
    modelVision: env.MODEL_VISION,
    modelReasoning: env.MODEL_REASONING,
  };

  try {
    const result = await runPipeline(cfg, payload);
    return jsonResponse(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(msg, 500);
  }
}
