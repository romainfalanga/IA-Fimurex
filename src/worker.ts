// Fimurex AI Agent - Cloudflare Worker entrypoint.
// Sert le frontend (static assets) et expose l'API de traitement.
// Supporte a la fois le mode JSON classique (/api/process) et le mode SSE
// temps-reel (/api/process-stream).

import { runPipeline, PipelineInput, PipelineEvent } from "./pipeline";
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
    return jsonResponse({ ok: true, version: "0.2.0" });
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

  if (url.pathname === "/api/process-stream" && request.method === "POST") {
    return handleProcessStream(request, env);
  }

  return errorResponse("Route inconnue", 404);
}

function resolveConfig(request: Request, env: Env): { cfg: OpenRouterConfig } | { error: Response } {
  const apiKey =
    request.headers.get("X-OpenRouter-Key") ??
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
    env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return {
      error: errorResponse(
        "OPENROUTER_API_KEY manquant. Fournissez-la via l'en-tete X-OpenRouter-Key " +
          "ou definissez le secret OPENROUTER_API_KEY cote Worker.",
        401,
      ),
    };
  }

  return {
    cfg: {
      apiKey,
      baseUrl: env.OPENROUTER_BASE_URL,
      modelVision: env.MODEL_VISION,
      modelReasoning: env.MODEL_REASONING,
    },
  };
}

async function parsePayload(request: Request): Promise<{ payload: PipelineInput } | { error: Response }> {
  let payload: PipelineInput;
  try {
    payload = (await request.json()) as PipelineInput;
  } catch {
    return { error: errorResponse("JSON invalide", 400) };
  }
  if (!payload?.pages?.length) {
    return { error: errorResponse("Aucune page fournie", 400) };
  }
  return { payload };
}

// ---- Classic JSON endpoint (backward-compatible) ----

async function handleProcess(request: Request, env: Env): Promise<Response> {
  const payloadResult = await parsePayload(request);
  if ("error" in payloadResult) return payloadResult.error;

  const configResult = resolveConfig(request, env);
  if ("error" in configResult) return configResult.error;

  try {
    let finalResult: Record<string, unknown> | null = null;

    await runPipeline(configResult.cfg, payloadResult.payload, (event) => {
      if (event.type === "pipeline_done") {
        finalResult = event.data.result as Record<string, unknown>;
      }
    });

    if (finalResult) {
      return jsonResponse(finalResult);
    }
    return errorResponse("Pipeline n'a pas produit de resultat", 500);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(msg, 500);
  }
}

// ---- SSE streaming endpoint ----

async function handleProcessStream(request: Request, env: Env): Promise<Response> {
  const payloadResult = await parsePayload(request);
  if ("error" in payloadResult) return payloadResult.error;

  const configResult = resolveConfig(request, env);
  if ("error" in configResult) return configResult.error;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(event: PipelineEvent) {
        const line = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(line));
      }

      try {
        await runPipeline(configResult.cfg, payloadResult.payload, sendEvent);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendEvent({
          type: "error",
          timestamp: Date.now(),
          data: { message: msg },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...CORS_HEADERS,
    },
  });
}
