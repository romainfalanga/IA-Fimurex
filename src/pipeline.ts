// Pipeline server-side : orchestre les appels OpenRouter (Gemini + Claude)
// a partir des pages deja pre-traitees cote client (texte extrait + image
// encodee en base64). Cf. sections 2.1 / 2.2 de la specification.

import { CarnetBA, finalizeCarnet, LigneCarnet } from "./calculation";
import { chat, OpenRouterConfig, parseJson } from "./openrouter";
import {
  SYSTEM_REASONING,
  SYSTEM_VISION,
  promptAssembleCarnet,
  promptExtractDetail,
  promptExtractFiche,
  promptExtractHypotheses,
  promptExtractLegende,
  promptExtractPageGarde,
  promptVisionPlan,
} from "./prompts";

export type PageCategory =
  | "PAGE_GARDE"
  | "PLAN_COFFRAGE"
  | "HYPOTHESES"
  | "DETAIL"
  | "FICHE_FABRICATION"
  | "ANNEXE";

export interface IngestedPage {
  index: number;
  category: PageCategory;
  text: string;
  niveau?: string;
  repere?: string;
  imageDataUrl?: string; // data:image/png;base64,...
}

export interface PipelineInput {
  pages: IngestedPage[];
  echelle?: string;
}

export interface PipelineOutput {
  carnet: CarnetBA;
  extracted: {
    metadonnees: Record<string, unknown>;
    hypotheses: Record<string, unknown>;
    legendes_par_niveau: Record<string, unknown>;
    fiches: Record<string, unknown>;
    details: Record<string, unknown>;
  };
  vision: Record<string, unknown>;
  anomalies: string[];
}

export async function runPipeline(
  cfg: OpenRouterConfig,
  input: PipelineInput,
): Promise<PipelineOutput> {
  // ---- Module 2 : extraction textuelle (Claude) ----
  const metadonnees: Record<string, unknown> = {};
  const hypotheses: Record<string, unknown> = {};
  const legendes: Record<string, unknown> = {};
  const fiches: Record<string, unknown> = {};
  const details: Record<string, unknown> = {};

  const extractionTasks: Promise<void>[] = [];

  for (const page of input.pages) {
    const prompt = textPromptFor(page);
    if (!prompt) continue;
    extractionTasks.push(
      (async () => {
        const raw = await chat(cfg, {
          model: cfg.modelReasoning,
          system: SYSTEM_REASONING,
          user: prompt,
          jsonResponse: true,
        });
        let parsed: Record<string, unknown>;
        try {
          parsed = parseJson<Record<string, unknown>>(raw);
        } catch {
          parsed = { _raw: raw };
        }
        switch (page.category) {
          case "PAGE_GARDE":
            Object.assign(metadonnees, parsed);
            break;
          case "HYPOTHESES":
            Object.assign(hypotheses, parsed);
            break;
          case "PLAN_COFFRAGE": {
            const niveau = (parsed.niveau as string) || page.niveau || `page_${page.index}`;
            legendes[niveau] = parsed;
            break;
          }
          case "FICHE_FABRICATION": {
            const repere = ((parsed.repere as string) || page.repere || "?").replace(/\s+/g, "");
            const niveau = (parsed.niveau as string) || page.niveau || "?";
            fiches[`${repere}@${niveau}`] = parsed;
            break;
          }
          case "DETAIL": {
            const element = (parsed.element as string) || `detail_${page.index}`;
            details[element] = parsed;
            break;
          }
        }
      })(),
    );
  }

  await Promise.all(extractionTasks);

  // ---- Module 3 : analyse visuelle (Gemini) ----
  const vision: Record<string, unknown> = {};
  const visionTasks: Promise<void>[] = [];

  for (const page of input.pages) {
    if (page.category !== "PLAN_COFFRAGE" || !page.imageDataUrl) continue;
    const niveau = page.niveau || `page_${page.index}`;
    const legendeTxt = JSON.stringify(legendes[niveau] ?? {}, null, 2);
    const prompt = promptVisionPlan(niveau, legendeTxt, input.echelle ?? "1/75");

    visionTasks.push(
      (async () => {
        const raw = await chat(cfg, {
          model: cfg.modelVision,
          system: SYSTEM_VISION,
          user: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: page.imageDataUrl! } },
          ],
          jsonResponse: true,
        });
        try {
          vision[niveau] = parseJson(raw);
        } catch {
          vision[niveau] = { _raw: raw };
        }
      })(),
    );
  }

  await Promise.all(visionTasks);

  // ---- Module 4 : assemblage (Claude) ----
  const assembleRaw = await chat(cfg, {
    model: cfg.modelReasoning,
    system: SYSTEM_REASONING,
    user: promptAssembleCarnet({
      metadonnees: JSON.stringify(metadonnees, null, 2),
      legendes: JSON.stringify(legendes, null, 2),
      details: JSON.stringify(details, null, 2),
      fiches: JSON.stringify(fiches, null, 2),
      comptages: JSON.stringify(vision, null, 2),
    }),
    jsonResponse: true,
  });

  const assembled = parseJson<{
    entete: CarnetBA["entete"];
    sections: Array<{
      section: string;
      lignes: Omit<LigneCarnet, "poids_total_kg">[];
    }>;
  }>(assembleRaw);

  // Entete depuis metadonnees si l'IA ne l'a pas reprise.
  const entete = assembled.entete ?? {
    dossier: (metadonnees.dossier as string) ?? "",
    chantier: (metadonnees.chantier as string) ?? "",
    commune: (metadonnees.commune as string) ?? "",
    zone_sismique: (metadonnees.zone_sismique as string) ?? "",
  };

  const carnet = finalizeCarnet({ entete, sections: assembled.sections ?? [] });

  // ---- Validation sommaire ----
  const anomalies: string[] = [];
  if (carnet.sections.length === 0) anomalies.push("Carnet vide");
  for (const s of carnet.sections) {
    for (const l of s.lignes) {
      if (l.poids_unitaire_kg <= 0 || l.quantite <= 0) {
        anomalies.push(`Ligne invalide (${s.section} / ${l.designation})`);
      }
    }
  }

  return {
    carnet,
    extracted: {
      metadonnees,
      hypotheses,
      legendes_par_niveau: legendes,
      fiches,
      details,
    },
    vision,
    anomalies,
  };
}

function textPromptFor(page: IngestedPage): string | null {
  switch (page.category) {
    case "PAGE_GARDE":
      return promptExtractPageGarde(page.text);
    case "HYPOTHESES":
      return promptExtractHypotheses(page.text);
    case "PLAN_COFFRAGE":
      return promptExtractLegende(page.text);
    case "FICHE_FABRICATION":
      return promptExtractFiche(page.text);
    case "DETAIL":
      return promptExtractDetail(page.text);
    default:
      return null;
  }
}
