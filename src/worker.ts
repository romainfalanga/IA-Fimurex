// Fimurex AI Agent - Cloudflare Worker entrypoint.
// Le traitement IA est 100% cote navigateur (appels OpenRouter directs
// depuis le frontend). Ce Worker ne sert plus que les assets statiques
// du dashboard, ce qui evite la limite de 50 sous-requetes du plan gratuit.

export interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return env.ASSETS.fetch(request);
  },
};
