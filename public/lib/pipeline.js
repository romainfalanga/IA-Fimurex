// Pipeline 100% client-side : orchestre les appels OpenRouter directement
// depuis le navigateur. Aucun Worker intermediaire, aucune limite de
// sous-requetes. Emet des evenements via un callback pour alimenter le
// dashboard en temps reel.

import { finalizeCarnet } from "./calculation.js";
import { chat, parseJson, MODEL } from "./openrouter.js";
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
} from "./prompts.js";

export async function runPipeline({ apiKey, pages }, emit) {
  const t0 = Date.now();
  const emitEvent = (type, data) =>
    emit({ type, timestamp: Date.now() - t0, data });

  const totalPages = pages.length;
  const planPages = pages.filter((p) => p.category === "PLAN_COFFRAGE");
  const extractablePages = pages.filter((p) => p.category !== "ANNEXE");

  emitEvent("pipeline_start", {
    totalPages,
    planPages: planPages.length,
    extractablePages: extractablePages.length,
    model: MODEL,
    categories: pages.map((p) => ({
      index: p.index,
      category: p.category,
      niveau: p.niveau ?? null,
    })),
  });

  for (const page of pages) {
    emitEvent("page_classified", {
      pageIndex: page.index,
      category: page.category,
      niveau: page.niveau ?? null,
      repere: page.repere ?? null,
      hasImage: Boolean(page.imageDataUrl),
    });
  }

  // ---- Module 2 : extraction textuelle (Gemini) ----
  const metadonnees = {};
  const hypotheses = {};
  const legendes = {};
  const fiches = {};
  const details = {};

  emitEvent("thinking", {
    message: `Demarrage de l'extraction textuelle de ${extractablePages.length} pages avec ${MODEL}.`,
    stage: "extraction",
  });

  await Promise.all(
    pages.map(async (page) => {
      const prompt = textPromptFor(page);
      if (!prompt) return;

      const categoryLabel = categoryFriendlyName(page.category);
      emitEvent("extraction_start", {
        pageIndex: page.index,
        category: page.category,
        categoryLabel,
        niveau: page.niveau ?? null,
      });

      emitEvent("thinking", {
        message: `Analyse de la page ${page.index + 1} (${categoryLabel}${page.niveau ? " - " + page.niveau : ""}) avec ${MODEL}...`,
        stage: "extraction",
        pageIndex: page.index,
      });

      let parsed;
      try {
        const raw = await chat({
          apiKey,
          system: SYSTEM_REASONING,
          user: prompt,
          jsonResponse: true,
        });
        try {
          parsed = parseJson(raw);
        } catch {
          parsed = { _raw: raw };
        }
      } catch (err) {
        parsed = { _error: err.message };
      }

      switch (page.category) {
        case "PAGE_GARDE":
          Object.assign(metadonnees, parsed);
          break;
        case "HYPOTHESES":
          Object.assign(hypotheses, parsed);
          break;
        case "PLAN_COFFRAGE": {
          const niveau = parsed.niveau || page.niveau || `page_${page.index}`;
          legendes[niveau] = parsed;
          break;
        }
        case "FICHE_FABRICATION": {
          const repere = String(parsed.repere || page.repere || "?").replace(/\s+/g, "");
          const niveau = parsed.niveau || page.niveau || "?";
          fiches[`${repere}@${niveau}`] = parsed;
          break;
        }
        case "DETAIL": {
          const element = parsed.element || `detail_${page.index}`;
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
    }),
  );

  emitEvent("thinking", {
    message: `Extraction textuelle terminee. Metadonnees : ${Object.keys(metadonnees).length} champs. Legendes : ${Object.keys(legendes).length} niveaux. Fiches : ${Object.keys(fiches).length}. Details : ${Object.keys(details).length}.`,
    stage: "extraction",
  });

  // ---- Module 3 : analyse visuelle (Gemini) ----
  const vision = {};

  if (planPages.length > 0) {
    emitEvent("thinking", {
      message: `Demarrage de l'analyse visuelle de ${planPages.length} plan(s) de coffrage avec ${MODEL}. L'echelle sera auto-detectee depuis le cartouche de chaque plan.`,
      stage: "vision",
    });
  }

  await Promise.all(
    pages.map(async (page) => {
      if (page.category !== "PLAN_COFFRAGE" || !page.imageDataUrl) return;
      const niveau = page.niveau || `page_${page.index}`;
      const legendeTxt = JSON.stringify(legendes[niveau] ?? {}, null, 2);
      const prompt = promptVisionPlan(niveau, legendeTxt);

      emitEvent("vision_start", { pageIndex: page.index, niveau });
      emitEvent("thinking", {
        message: `Envoi du plan "${niveau}" (page ${page.index + 1}) a ${MODEL}. Le modele va lire l'echelle dans le cartouche, identifier et compter les elements structurels.`,
        stage: "vision",
        pageIndex: page.index,
      });

      let parsed;
      try {
        const raw = await chat({
          apiKey,
          system: SYSTEM_VISION,
          user: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: page.imageDataUrl } },
          ],
          jsonResponse: true,
        });
        try {
          parsed = parseJson(raw);
        } catch {
          parsed = { _raw: raw };
        }
      } catch (err) {
        parsed = { _error: err.message };
      }

      vision[niveau] = parsed;
      const echelleDetectee = parsed.echelle_detectee || "non detectee";

      emitEvent("vision_done", {
        pageIndex: page.index,
        niveau,
        echelleDetectee,
        result: parsed,
      });
      emitEvent("thinking", {
        message: `Vision terminee pour "${niveau}" — echelle detectee : ${echelleDetectee}. Elements : ${summarizeVisionResult(parsed)}.`,
        stage: "vision",
        pageIndex: page.index,
      });
    }),
  );

  // ---- Module 4 : assemblage (Gemini) ----
  emitEvent("assembly_start", {
    message: "Assemblage du Carnet BA final a partir de toutes les donnees extraites et des comptages visuels.",
  });

  emitEvent("thinking", {
    message: `Envoi de toutes les donnees a ${MODEL} pour assembler le Carnet BA. ${Object.keys(metadonnees).length} champs metadonnees, ${Object.keys(legendes).length} legendes, ${Object.keys(details).length} details, ${Object.keys(fiches).length} fiches, ${Object.keys(vision).length} comptages visuels.`,
    stage: "assembly",
  });

  const assembleRaw = await chat({
    apiKey,
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

  const assembled = parseJson(assembleRaw);
  const entete = assembled.entete ?? {
    dossier: metadonnees.dossier ?? "",
    chantier: metadonnees.chantier ?? "",
    commune: metadonnees.commune ?? "",
    zone_sismique: metadonnees.zone_sismique ?? "",
  };

  const carnet = finalizeCarnet({
    entete,
    sections: assembled.sections ?? [],
  });

  emitEvent("assembly_done", {
    carnet,
    nbSections: carnet.sections.length,
    nbLignes: carnet.sections.reduce((a, s) => a + s.lignes.length, 0),
    totalKg: carnet.total_general_kg,
  });
  emitEvent("thinking", {
    message: `Carnet assemble : ${carnet.sections.length} sections, ${carnet.sections.reduce((a, s) => a + s.lignes.length, 0)} lignes, total general ${carnet.total_general_kg.toFixed(2)} kg.`,
    stage: "assembly",
  });

  // ---- Validation sommaire ----
  const anomalies = [];
  if (carnet.sections.length === 0) anomalies.push("Carnet vide");
  for (const s of carnet.sections) {
    for (const l of s.lignes) {
      if (l.poids_unitaire_kg <= 0 || l.quantite <= 0) {
        anomalies.push(`Ligne invalide (${s.section} / ${l.designation})`);
      }
    }
  }

  emitEvent("validation_done", {
    anomalies,
    nbAnomalies: anomalies.length,
  });
  emitEvent("thinking", {
    message:
      anomalies.length > 0
        ? `Validation : ${anomalies.length} anomalie(s) detectee(s) : ${anomalies.join(", ")}.`
        : "Validation terminee sans anomalie.",
    stage: "validation",
  });

  const result = {
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

  return result;
}

// ---- Helpers ----

function textPromptFor(page) {
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

function categoryFriendlyName(category) {
  const map = {
    PAGE_GARDE: "Page de garde",
    PLAN_COFFRAGE: "Plan de coffrage",
    HYPOTHESES: "Hypotheses",
    DETAIL: "Detail",
    FICHE_FABRICATION: "Fiche de fabrication",
    ANNEXE: "Annexe",
  };
  return map[category] || category;
}

function summarizeVisionResult(result) {
  const parts = [];
  const ponctuels = result.elements_ponctuels;
  if (ponctuels) {
    const nonZero = Object.entries(ponctuels)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k}=${v}`);
    if (nonZero.length) parts.push(`ponctuels: ${nonZero.join(", ")}`);
  }
  const angles = result.angles;
  if (angles) {
    const nonZero = Object.entries(angles)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k}=${v}`);
    if (nonZero.length) parts.push(`angles: ${nonZero.join(", ")}`);
  }
  return parts.length > 0 ? parts.join(" | ") : "aucun element detecte";
}
