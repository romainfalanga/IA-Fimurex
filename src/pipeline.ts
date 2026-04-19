// Pipeline server-side : orchestre les appels OpenRouter (Gemini + Claude)
// a partir des pages deja pre-traitees cote client (texte extrait + image
// encodee en base64). Cf. sections 2.1 / 2.2 de la specification.
//
// Emet des evenements SSE via un callback pour permettre un suivi temps-reel
// dans le dashboard frontend.

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

export type EventType =
  | "pipeline_start"
  | "page_classified"
  | "extraction_start"
  | "extraction_done"
  | "vision_start"
  | "vision_done"
  | "thinking"
  | "assembly_start"
  | "assembly_done"
  | "validation_done"
  | "pipeline_done"
  | "error";

export interface PipelineEvent {
  type: EventType;
  timestamp: number;
  data: Record<string, unknown>;
}

export async function runPipeline(
  cfg: OpenRouterConfig,
  input: PipelineInput,
  emit: (event: PipelineEvent) => void,
): Promise<void> {
  const t0 = Date.now();

  function emitEvent(type: EventType, data: Record<string, unknown>) {
    emit({ type, timestamp: Date.now() - t0, data });
  }

  // ---- Pipeline start ----
  const totalPages = input.pages.length;
  const planPages = input.pages.filter((p) => p.category === "PLAN_COFFRAGE");
  const extractablePages = input.pages.filter(
    (p) => p.category !== "ANNEXE",
  );

  emitEvent("pipeline_start", {
    totalPages,
    planPages: planPages.length,
    extractablePages: extractablePages.length,
    categories: input.pages.map((p) => ({
      index: p.index,
      category: p.category,
      niveau: p.niveau ?? null,
    })),
  });

  // Emit page classifications
  for (const page of input.pages) {
    emitEvent("page_classified", {
      pageIndex: page.index,
      category: page.category,
      niveau: page.niveau ?? null,
      repere: page.repere ?? null,
      hasImage: Boolean(page.imageDataUrl),
    });
  }

  // ---- Module 2 : extraction textuelle (Claude) ----
  const metadonnees: Record<string, unknown> = {};
  const hypotheses: Record<string, unknown> = {};
  const legendes: Record<string, unknown> = {};
  const fiches: Record<string, unknown> = {};
  const details: Record<string, unknown> = {};

  emitEvent("thinking", {
    message: `Demarrage de l'extraction textuelle de ${extractablePages.length} pages avec le modele de raisonnement (${cfg.modelReasoning}).`,
    stage: "extraction",
  });

  const extractionTasks: Promise<void>[] = [];

  for (const page of input.pages) {
    const prompt = textPromptFor(page);
    if (!prompt) continue;

    extractionTasks.push(
      (async () => {
        const categoryLabel = categoryFriendlyName(page.category);
        emitEvent("extraction_start", {
          pageIndex: page.index,
          category: page.category,
          categoryLabel,
          niveau: page.niveau ?? null,
        });

        emitEvent("thinking", {
          message: `Analyse de la page ${page.index + 1} (${categoryLabel}${page.niveau ? " - " + page.niveau : ""}) avec ${cfg.modelReasoning}...`,
          stage: "extraction",
          pageIndex: page.index,
        });

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
            const niveau =
              (parsed.niveau as string) ||
              page.niveau ||
              `page_${page.index}`;
            legendes[niveau] = parsed;
            break;
          }
          case "FICHE_FABRICATION": {
            const repere = (
              (parsed.repere as string) ||
              page.repere ||
              "?"
            ).replace(/\s+/g, "");
            const niveau =
              (parsed.niveau as string) || page.niveau || "?";
            fiches[`${repere}@${niveau}`] = parsed;
            break;
          }
          case "DETAIL": {
            const element =
              (parsed.element as string) || `detail_${page.index}`;
            details[element] = parsed;
            break;
          }
        }

        emitEvent("extraction_done", {
          pageIndex: page.index,
          category: page.category,
          categoryLabel,
          niveau: page.niveau ?? null,
          result: parsed,
        });
      })(),
    );
  }

  await Promise.all(extractionTasks);

  emitEvent("thinking", {
    message: `Extraction textuelle terminee. Metadonnees extraites : ${Object.keys(metadonnees).length} champs. Legendes : ${Object.keys(legendes).length} niveaux. Fiches : ${Object.keys(fiches).length}. Details : ${Object.keys(details).length}.`,
    stage: "extraction",
  });

  // ---- Module 3 : analyse visuelle (Gemini) ----
  const vision: Record<string, unknown> = {};
  const visionTasks: Promise<void>[] = [];

  if (planPages.length > 0) {
    emitEvent("thinking", {
      message: `Demarrage de l'analyse visuelle de ${planPages.length} plan(s) de coffrage avec le modele de vision (${cfg.modelVision}). L'echelle sera auto-detectee depuis le cartouche de chaque plan.`,
      stage: "vision",
    });
  }

  for (const page of input.pages) {
    if (page.category !== "PLAN_COFFRAGE" || !page.imageDataUrl) continue;
    const niveau = page.niveau || `page_${page.index}`;
    const legendeTxt = JSON.stringify(legendes[niveau] ?? {}, null, 2);
    const prompt = promptVisionPlan(niveau, legendeTxt);

    visionTasks.push(
      (async () => {
        emitEvent("vision_start", {
          pageIndex: page.index,
          niveau,
        });

        emitEvent("thinking", {
          message: `Envoi du plan "${niveau}" (page ${page.index + 1}) au modele de vision ${cfg.modelVision}. Gemini va lire l'echelle dans le cartouche, identifier et compter les elements structurels.`,
          stage: "vision",
          pageIndex: page.index,
        });

        const raw = await chat(cfg, {
          model: cfg.modelVision,
          system: SYSTEM_VISION,
          user: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: page.imageDataUrl! } },
          ],
          jsonResponse: true,
        });

        let parsed: Record<string, unknown>;
        try {
          parsed = parseJson(raw);
        } catch {
          parsed = { _raw: raw };
        }

        vision[niveau] = parsed;

        const echelleDetectee =
          (parsed.echelle_detectee as string) || "non detectee";
        emitEvent("vision_done", {
          pageIndex: page.index,
          niveau,
          echelleDetectee,
          result: parsed,
        });

        emitEvent("thinking", {
          message: `Vision terminee pour "${niveau}" — echelle detectee : ${echelleDetectee}. Elements trouves : ${summarizeVisionResult(parsed)}.`,
          stage: "vision",
          pageIndex: page.index,
        });
      })(),
    );
  }

  await Promise.all(visionTasks);

  // ---- Module 4 : assemblage (Claude) ----
  emitEvent("assembly_start", {
    message:
      "Assemblage du Carnet BA final a partir de toutes les donnees extraites et des comptages visuels.",
  });

  emitEvent("thinking", {
    message: `Envoi de toutes les donnees au modele de raisonnement (${cfg.modelReasoning}) pour assembler le Carnet BA. Donnees en entree : ${Object.keys(metadonnees).length} champs metadonnees, ${Object.keys(legendes).length} legendes, ${Object.keys(details).length} details, ${Object.keys(fiches).length} fiches, ${Object.keys(vision).length} comptages visuels.`,
    stage: "assembly",
  });

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

  const carnet = finalizeCarnet({
    entete,
    sections: assembled.sections ?? [],
  });

  emitEvent("assembly_done", {
    carnet,
    nbSections: carnet.sections.length,
    nbLignes: carnet.sections.reduce(
      (acc, s) => acc + s.lignes.length,
      0,
    ),
    totalKg: carnet.total_general_kg,
  });

  emitEvent("thinking", {
    message: `Carnet assemble : ${carnet.sections.length} sections, ${carnet.sections.reduce((a, s) => a + s.lignes.length, 0)} lignes, total general ${carnet.total_general_kg.toFixed(2)} kg.`,
    stage: "assembly",
  });

  // ---- Validation sommaire ----
  const anomalies: string[] = [];
  if (carnet.sections.length === 0) anomalies.push("Carnet vide");
  for (const s of carnet.sections) {
    for (const l of s.lignes) {
      if (l.poids_unitaire_kg <= 0 || l.quantite <= 0) {
        anomalies.push(
          `Ligne invalide (${s.section} / ${l.designation})`,
        );
      }
    }
  }

  emitEvent("validation_done", {
    anomalies,
    nbAnomalies: anomalies.length,
  });

  if (anomalies.length > 0) {
    emitEvent("thinking", {
      message: `Validation : ${anomalies.length} anomalie(s) detectee(s) : ${anomalies.join(", ")}.`,
      stage: "validation",
    });
  } else {
    emitEvent("thinking", {
      message: "Validation terminee sans anomalie.",
      stage: "validation",
    });
  }

  // ---- Done ----
  const result: PipelineOutput = {
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

  emitEvent("pipeline_done", {
    result,
    durationMs: Date.now() - t0,
  });
}

// ---- Helpers ----

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

function categoryFriendlyName(category: PageCategory): string {
  switch (category) {
    case "PAGE_GARDE":
      return "Page de garde";
    case "PLAN_COFFRAGE":
      return "Plan de coffrage";
    case "HYPOTHESES":
      return "Hypotheses";
    case "DETAIL":
      return "Detail";
    case "FICHE_FABRICATION":
      return "Fiche de fabrication";
    case "ANNEXE":
      return "Annexe";
    default:
      return category;
  }
}

function summarizeVisionResult(result: Record<string, unknown>): string {
  const parts: string[] = [];
  const ponctuels = result.elements_ponctuels as
    | Record<string, number>
    | undefined;
  if (ponctuels) {
    const nonZero = Object.entries(ponctuels)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k}=${v}`);
    if (nonZero.length) parts.push(`ponctuels: ${nonZero.join(", ")}`);
  }
  const angles = result.angles as Record<string, number> | undefined;
  if (angles) {
    const nonZero = Object.entries(angles)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k}=${v}`);
    if (nonZero.length) parts.push(`angles: ${nonZero.join(", ")}`);
  }
  return parts.length > 0 ? parts.join(" | ") : "aucun element detecte";
}
