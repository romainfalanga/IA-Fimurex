# Deploiement Cloudflare

Ce projet est conçu pour etre deploye en tant que **Cloudflare Worker** (avec
assets statiques) lie au depot GitHub. Deux voies de deploiement sont
disponibles : **Workers Builds** (recommande, pilote depuis le dashboard
Cloudflare) ou **GitHub Actions** (utile pour un contrôle CI supplementaire).

## Architecture

```
Navigateur                  Cloudflare Worker                OpenRouter
(PDF -> texte + PNG)  --->  /api/process             --->   Gemini + Claude
                            (orchestration LLM)
```

- Le frontend (`public/`) est servi par Workers Static Assets.
- Le Worker (`src/worker.ts`) expose `/api/process` et delegue au moteur
  Python equivalent porte en TypeScript (`src/calculation.ts`, `src/pipeline.ts`).
- La clef OpenRouter peut etre transmise :
  - par le client via l'en-tete `X-OpenRouter-Key` (champ du formulaire), ou
  - definie comme secret Worker (`wrangler secret put OPENROUTER_API_KEY`).

## Option 1 : Workers Builds (Cloudflare Dashboard) — recommandee

Cette voie connecte directement le depot GitHub a Cloudflare : chaque push
sur la branche declenche un build + deploy automatique, sans secrets GitHub
a gerer.

1. Dans le dashboard Cloudflare : **Workers & Pages** -> **Create** ->
   **Import from Git** -> autoriser l'acces a `romainfalanga/IA-Fimurex`.
2. Selectionner la branche (`main` ou `claude/ai-agent-ba-transformation-7C3LV`).
3. **Build configuration** :
   - *Framework preset* : **None**
   - *Build command* : `npm install && npx tsc --noEmit`
   - *Deploy command* : `npx wrangler deploy`
   - *Root directory* : `/`
4. **Secrets runtime** (Settings -> Variables & Secrets -> *Secret*) :
   - `OPENROUTER_API_KEY` : clef OpenRouter (facultatif, peut aussi etre
     fournie cote client).
5. Cliquer **Create & Deploy**. Cloudflare detecte `wrangler.toml`,
   construit le Worker et publie sur `https://fimurex-ia-agent.<subdomain>.workers.dev`.

## Option 2 : GitHub Actions

Alternative si vous preferez un CI pilote depuis GitHub. Le workflow
`.github/workflows/deploy.yml` est deja configure.

1. Generer un **API Token** Cloudflare :
   - Dashboard -> **My Profile** -> **API Tokens** -> **Create Token**
   - Modele *Edit Cloudflare Workers*, scope restreint au compte
     `834ee251038ce2f923cba9847f973c40`.
2. Ajouter les secrets dans GitHub :
   - `CLOUDFLARE_API_TOKEN` : le token genere
   - `CLOUDFLARE_ACCOUNT_ID` : `834ee251038ce2f923cba9847f973c40`
3. Pousser sur `main` ou `claude/**` : le workflow s'execute et deploie.

## Execution locale

```bash
npm install
npx wrangler dev           # dev local sur http://localhost:8787
npx wrangler deploy        # deploiement manuel vers Cloudflare
```

## CLI Python (alternative locale)

Le code Python (`fimurex_agent/`) reste utilisable hors Cloudflare pour
traitement batch sur poste technicien :

```bash
pip install -r requirements.txt
export OPENROUTER_API_KEY=sk-or-v1-...
python -m fimurex_agent etude_ba.pdf -o output/
```

## Variables / secrets

| Nom                  | Type    | Usage                                   |
| -------------------- | ------- | --------------------------------------- |
| OPENROUTER_API_KEY   | secret  | Clef OpenRouter (Worker ou CLI)         |
| OPENROUTER_BASE_URL  | var     | Par defaut `https://openrouter.ai/api/v1` |
| MODEL_VISION         | var     | `google/gemini-2.5-pro`                 |
| MODEL_REASONING      | var     | `anthropic/claude-opus-4.6`             |
