// ==========================================================================
// Pipeline 100% client-side avec architecture skill-based
// ==========================================================================
// Etapes sequentielles garantissant la coherence des donnees :
//   1. Extraction textuelle (IA) — toutes les pages en parallele
//   2. Vision (IA) — APRES extraction, utilise les legendes extraites
//   3. Assemblage (CODE) — deterministe, aucun appel IA
//   4. Validation (CODE) — controles de coherence
//
// METRE-FIRST : l'IA mesure des longueurs et compte des elements.
// Le code calcule les quantites (recouvrement) et les poids (masses lineiques).
// ==========================================================================

import { MODEL } from "./openrouter.js";
import {
  extractPageGarde,
  extractHypotheses,
  extractLegende,
  extractFiche,
  extractDetail,
} from "./skills/extraction.js";
import { analyzePlan } from "./skills/vision.js";
import { assembleCarnet } from "./skills/assembly.js";
import { validateCarnet } from "./skills/validation.js";

export async function runPipeline({ apiKey, pages }, emit) {
  const t0 = Date.now();
  const ev = (type, data) => emit({ type, timestamp: Date.now() - t0, data });

  const planPages = pages.filter((p) => p.category === "PLAN_COFFRAGE");
  const extractablePages = pages.filter((p) => p.category !== "ANNEXE");

  ev("pipeline_start", {
    totalPages: pages.length,
    planPages: planPages.length,
    extractablePages: extractablePages.length,
    model: MODEL,
  });

  // Emit page classifications
  for (const page of pages) {
    ev("page_classified", {
      pageIndex: page.index,
      category: page.category,
      niveau: page.niveau ?? null,
      repere: page.repere ?? null,
      hasImage: Boolean(page.imageDataUrl),
    });
  }

  // ==================================================================
  // ETAPE 1 : Extraction textuelle (IA, en parallele)
  // ==================================================================
  const metadonnees = {};
  const hypotheses = {};
  const legendes = {};
  const fiches = {};
  const details = {};

  ev("thinking", {
    message: `Extraction textuelle de ${extractablePages.length} pages avec ${MODEL}. L'IA extrait les dimensions (metres/cm), le code calculera quantites et poids.`,
    stage: "extraction",
  });

  const extractionResults = await Promise.allSettled(
    pages.map(async (page) => {
      const extractor = getExtractor(page.category);
      if (!extractor) return null;

      const label = categoryLabel(page.category);
      ev("extraction_start", {
        pageIndex: page.index,
        category: page.category,
        categoryLabel: label,
        niveau: page.niveau ?? null,
      });

      ev("thinking", {
        message: `Lecture de la page ${page.index + 1} (${label}${page.niveau ? " - " + page.niveau : ""})...`,
        stage: "extraction",
        pageIndex: page.index,
      });

      const result = await extractor(apiKey, page.text);

      // Store result with deduplication handling
      storeExtraction(page, result, metadonnees, hypotheses, legendes, fiches, details);

      ev("extraction_done", {
        pageIndex: page.index,
        category: page.category,
        categoryLabel: label,
        niveau: page.niveau ?? null,
        result,
      });

      return result;
    }),
  );

  // Count extraction successes/failures
  const extractOk = extractionResults.filter((r) => r.status === "fulfilled" && r.value).length;
  const extractFail = extractionResults.filter((r) => r.status === "rejected").length;

  ev("thinking", {
    message: `Extraction terminee : ${extractOk} reussies, ${extractFail} echouees. ` +
      `Legendes : ${Object.keys(legendes).length} niveaux. Fiches : ${Object.keys(fiches).length}. ` +
      `Details : ${Object.keys(details).length}.`,
    stage: "extraction",
  });

  // ==================================================================
  // ETAPE 2 : Analyse visuelle (IA, APRES extraction pour avoir les legendes)
  // ==================================================================
  const vision = {};

  if (planPages.length > 0) {
    ev("thinking", {
      message: `Analyse visuelle de ${planPages.length} plan(s) avec ${MODEL}. ` +
        `L'IA mesure les longueurs en metres et compte les elements (metre-first). ` +
        `Les legendes extraites guident le comptage.`,
      stage: "vision",
    });

    await Promise.allSettled(
      pages.map(async (page) => {
        if (page.category !== "PLAN_COFFRAGE" || !page.imageDataUrl) return;
        const niveau = page.niveau || `page_${page.index}`;
        const legende = legendes[niveau] ?? null;

        ev("vision_start", { pageIndex: page.index, niveau });
        ev("thinking", {
          message: `Envoi du plan "${niveau}" (page ${page.index + 1}) a ${MODEL}` +
            (legende ? ` avec ${legende.armatures?.length ?? 0} reperes de legende.` : " (pas de legende extraite)."),
          stage: "vision",
          pageIndex: page.index,
        });

        try {
          const result = await analyzePlan(apiKey, page.imageDataUrl, niveau, legende);
          vision[niveau] = result;

          const echelle = result.echelle_detectee || "non detectee";
          const confiance = result.confiance_echelle || "?";
          ev("vision_done", {
            pageIndex: page.index,
            niveau,
            echelleDetectee: echelle,
            confianceEchelle: confiance,
            result,
          });
          ev("thinking", {
            message: `Vision "${niveau}" — echelle ${echelle} (confiance: ${confiance}). ` +
              `Elements : ${summarizeCounts(result)}.`,
            stage: "vision",
            pageIndex: page.index,
          });
        } catch (err) {
          vision[niveau] = { _error: err.message };
          ev("thinking", {
            message: `Erreur vision "${niveau}" : ${err.message}`,
            stage: "vision",
            pageIndex: page.index,
          });
        }
      }),
    );
  }

  // ==================================================================
  // ETAPE 3 : Assemblage deterministe (CODE, aucun appel IA)
  // ==================================================================
  ev("assembly_start", {
    message: "Assemblage deterministe du Carnet BA (moteur de calcul, aucun appel IA).",
  });

  ev("thinking", {
    message: `Assemblage metre-first : ${Object.keys(legendes).length} legendes, ` +
      `${Object.keys(details).length} details, ${Object.keys(fiches).length} fiches, ` +
      `${Object.keys(vision).length} comptages visuels. ` +
      `Longueurs -> recouvrement (5.50m utile/6m) -> quantites -> poids (masses lineiques).`,
    stage: "assembly",
  });

  const carnet = assembleCarnet({ metadonnees, legendes, details, fiches, vision, hypotheses });

  ev("assembly_done", {
    carnet,
    nbSections: carnet.sections.length,
    nbLignes: carnet.sections.reduce((a, s) => a + s.lignes.length, 0),
    totalKg: carnet.total_general_kg,
  });

  ev("thinking", {
    message: `Carnet assemble : ${carnet.sections.length} sections, ` +
      `${carnet.sections.reduce((a, s) => a + s.lignes.length, 0)} lignes, ` +
      `total ${carnet.total_general_kg.toFixed(2)} kg.`,
    stage: "assembly",
  });

  // ==================================================================
  // ETAPE 4 : Validation (CODE)
  // ==================================================================
  const extracted = {
    metadonnees,
    hypotheses,
    legendes_par_niveau: legendes,
    fiches,
    details,
  };

  const { anomalies, warnings } = validateCarnet(carnet, extracted, vision);

  ev("validation_done", {
    anomalies,
    warnings,
    nbAnomalies: anomalies.length,
    nbWarnings: warnings.length,
  });

  if (anomalies.length > 0 || warnings.length > 0) {
    ev("thinking", {
      message: `Validation : ${anomalies.length} anomalie(s), ${warnings.length} avertissement(s). ` +
        (anomalies.length > 0 ? `Anomalies : ${anomalies.slice(0, 3).join(" | ")}` : ""),
      stage: "validation",
    });
  } else {
    ev("thinking", {
      message: "Validation terminee sans anomalie ni avertissement.",
      stage: "validation",
    });
  }

  // ==================================================================
  // RESULTAT FINAL
  // ==================================================================
  const result = { carnet, extracted, vision, anomalies, warnings };

  ev("pipeline_done", {
    result,
    durationMs: Date.now() - t0,
  });

  return result;
}

// ---- Helpers ----

function getExtractor(category) {
  switch (category) {
    case "PAGE_GARDE": return extractPageGarde;
    case "HYPOTHESES": return extractHypotheses;
    case "PLAN_COFFRAGE": return extractLegende;
    case "FICHE_FABRICATION": return extractFiche;
    case "DETAIL": return extractDetail;
    default: return null;
  }
}

function storeExtraction(page, result, metadonnees, hypotheses, legendes, fiches, details) {
  if (!result) return;
  switch (page.category) {
    case "PAGE_GARDE":
      Object.assign(metadonnees, result);
      break;
    case "HYPOTHESES":
      Object.assign(hypotheses, result);
      break;
    case "PLAN_COFFRAGE": {
      const niveau = result.niveau || page.niveau || `page_${page.index}`;
      if (legendes[niveau]) {
        // Merge : concatener les armatures au lieu d'ecraser
        const existing = legendes[niveau].armatures || [];
        const incoming = result.armatures || [];
        legendes[niveau] = {
          ...legendes[niveau],
          ...result,
          armatures: mergeArmatures(existing, incoming),
        };
      } else {
        legendes[niveau] = result;
      }
      break;
    }
    case "FICHE_FABRICATION": {
      const repere = String(result.repere || page.repere || "?").replace(/\s+/g, "");
      const niveau = result.niveau || page.niveau || "?";
      fiches[`${repere}@${niveau}`] = result;
      break;
    }
    case "DETAIL": {
      const element = result.element || `detail_${page.index}`;
      details[element] = result;
      break;
    }
  }
}

function mergeArmatures(existing, incoming) {
  const map = new Map();
  for (const a of existing) {
    if (a.repere) map.set(a.repere, a);
  }
  for (const a of incoming) {
    if (a.repere && !map.has(a.repere)) map.set(a.repere, a);
  }
  return Array.from(map.values());
}

function categoryLabel(category) {
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

function summarizeCounts(v) {
  const parts = [];
  const p = v.elements_ponctuels;
  if (p) {
    const nz = Object.entries(p).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`);
    if (nz.length) parts.push(nz.join(", "));
  }
  const a = v.angles;
  if (a) {
    const nz = Object.entries(a).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`);
    if (nz.length) parts.push(nz.join(", "));
  }
  return parts.length > 0 ? parts.join(" | ") : "aucun element";
}
