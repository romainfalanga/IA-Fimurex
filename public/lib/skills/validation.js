// ==========================================================================
// SKILL : Validation du Carnet BA
// ==========================================================================
// Effectue des controles de coherence sur le Carnet assemble :
// - Verification arithmetique (poids_total = poids_unitaire * quantite)
// - Plausibilite des poids unitaires (fourchettes metier)
// - Completude (chaque niveau a des elements)
// - Reconciliation vision vs. carnet
//
// Usage :
//   import { validateCarnet } from "./skills/validation.js";
//   const { anomalies, warnings } = validateCarnet(carnet, extracted, vision);
// ==========================================================================

import { round2, nbUnitesFromMetre, longueurUtile, LONGUEUR_BARRE_STD } from "../calculation.js";

// Fourchettes de poids unitaire plausibles par type d'element (kg)
const WEIGHT_RANGES = {
  CV: [3, 35],
  SF50: [10, 50],
  SF50e: [10, 55],
  CH: [5, 40],
  CP: [5, 40],
  Lt1: [2, 25],
  Lt2: [3, 35],
  Lt3: [5, 45],
  Lt4: [8, 55],
  "Pot.1": [3, 60],
  "Pot.2": [5, 100],
  Equerre: [0.2, 5.0],
  U: [0.2, 6.0],
  Crosse: [0.1, 4.0],
};

export function validateCarnet(carnet, extracted, visionResults) {
  const anomalies = [];
  const warnings = [];

  if (!carnet || !carnet.sections || carnet.sections.length === 0) {
    anomalies.push("Carnet vide : aucune section generee.");
    return { anomalies, warnings };
  }

  // 1. Verification arithmetique
  for (const s of carnet.sections) {
    let sectionSum = 0;
    for (const l of s.lignes) {
      const expected = round2(l.poids_unitaire_kg * l.quantite);
      if (Math.abs(l.poids_total_kg - expected) > 0.05) {
        anomalies.push(
          `[${s.section}] ${l.designation} : poids_total ${l.poids_total_kg} != ` +
          `${l.poids_unitaire_kg} x ${l.quantite} = ${expected}`,
        );
      }
      if (l.poids_unitaire_kg <= 0) {
        anomalies.push(`[${s.section}] ${l.designation} : poids unitaire nul ou negatif.`);
      }
      if (l.quantite <= 0) {
        anomalies.push(`[${s.section}] ${l.designation} : quantite nulle ou negative.`);
      }
      sectionSum += l.poids_total_kg;
    }
    // Verifier le total de section
    if (Math.abs(s.poids_section_kg - round2(sectionSum)) > 0.1) {
      warnings.push(
        `[${s.section}] Total section ${s.poids_section_kg} kg != somme des lignes ${round2(sectionSum)} kg.`,
      );
    }
  }

  // 2. Plausibilite des poids unitaires
  for (const s of carnet.sections) {
    for (const l of s.lignes) {
      const range = findWeightRange(l.designation, l.nomenclature);
      if (range) {
        const [min, max] = range;
        if (l.poids_unitaire_kg < min || l.poids_unitaire_kg > max) {
          warnings.push(
            `[${s.section}] ${l.designation} : poids unitaire ${l.poids_unitaire_kg} kg ` +
            `hors fourchette attendue [${min}-${max}] kg.`,
          );
        }
      }
    }
  }

  // 3. Reconciliation vision vs. carnet
  const ELEM_ALIASES = {
    Att_CV: ["CV", "Attentes CV"],
    CV: ["CV", "Attentes CV"],
    VR: ["VR", "Voile"],
  };

  if (visionResults) {
    for (const [niveau, vData] of Object.entries(visionResults)) {
      if (/^page_\d+$/.test(niveau)) continue;
      if (vData._error) continue;
      const section = carnet.sections.find((s) => matchNiveau(s.section, niveau));
      if (!section) {
        warnings.push(`Vision "${niveau}" : aucune section correspondante dans le carnet.`);
        continue;
      }

      const ponctuels = vData.elements_ponctuels || {};
      for (const [elem, count] of Object.entries(ponctuels)) {
        if (count > 0) {
          const aliases = ELEM_ALIASES[elem] || [elem];
          const found = section.lignes.some(
            (l) => aliases.some((a) =>
              l.designation === a || l.designation.includes(a)
            ),
          );
          if (!found) {
            warnings.push(
              `Vision "${niveau}" : ${count} ${elem} comptes mais absents du carnet.`,
            );
          }
        }
      }
    }
  }

  // 4. Completude
  if (extracted?.legendes_par_niveau) {
    for (const niveau of Object.keys(extracted.legendes_par_niveau)) {
      if (/^page_\d+$/.test(niveau)) continue;
      const section = carnet.sections.find((s) => matchNiveau(s.section, niveau));
      if (!section) {
        warnings.push(
          `Legende extraite pour "${niveau}" mais aucune section dans le carnet.`,
        );
      }
    }
  }

  // 5. Recouvrement consistency (metre-first)
  for (const s of carnet.sections) {
    for (const l of s.lignes) {
      if (l.longueur_totale_m != null && l.longueur_unitaire_m != null) {
        const expectedQte = nbUnitesFromMetre(l.designation, l.longueur_totale_m);
        if (expectedQte !== l.quantite) {
          warnings.push(
            `[${s.section}] ${l.designation} : quantite ${l.quantite} != ` +
            `ceil(${l.longueur_totale_m}m / ${l.longueur_unitaire_m}m) = ${expectedQte}.`,
          );
        }
      }
    }
  }

  // 6. Total general
  const expectedTotal = round2(
    carnet.sections.reduce((acc, s) => acc + s.poids_section_kg, 0),
  );
  if (Math.abs(carnet.total_general_kg - expectedTotal) > 0.1) {
    anomalies.push(
      `Total general ${carnet.total_general_kg} kg != somme des sections ${expectedTotal} kg.`,
    );
  }

  return { anomalies, warnings };
}

// ---- Helpers ----

function findWeightRange(designation, nomenclature) {
  const des = (designation || "").toUpperCase();
  const nom = (nomenclature || "").toUpperCase();

  if (des.includes("EQUERRE") || nom.includes("EQUERRE")) return WEIGHT_RANGES.Equerre;
  if (des.includes("U LIAISON") || nom.startsWith("U HA")) return WEIGHT_RANGES.U;
  if (des.includes("CROSSE") || nom.includes("CROSSE")) return WEIGHT_RANGES.Crosse;

  for (const [key, range] of Object.entries(WEIGHT_RANGES)) {
    if (des === key || des.startsWith(key + " ") || des.startsWith(key + ".")) {
      return range;
    }
  }
  return null;
}

function matchNiveau(a, b) {
  if (!a || !b) return false;
  const na = a.toLowerCase().replace(/\s+/g, "");
  const nb = b.toLowerCase().replace(/\s+/g, "");
  return na === nb || na.includes(nb) || nb.includes(na);
}
