// ==========================================================================
// SKILL : Assemblage deterministe du Carnet BA
// ==========================================================================
// Construit le Carnet BA a partir des donnees extraites et des comptages
// visuels. AUCUN appel IA : tous les poids sont calcules par le moteur
// deterministe (calculation.js) et les quantites viennent des comptages
// vision + regles metier.
//
// Usage :
//   import { assembleCarnet } from "./skills/assembly.js";
//   const carnet = assembleCarnet({ metadonnees, legendes, details, fiches, vision, hypotheses });
//
// Le resultat est un objet CarnetBA pret a l'affichage, avec poids_total
// recalcule pour chaque ligne et section.
// ==========================================================================

import {
  poidsCageStandard,
  poidsEquerre,
  poidsU,
  poidsCrosse,
  poidsBarreSimple,
  poidsTreillisSoude,
  poidsAttentesBlocsABancher,
  round2,
  MASSES_LINEIQUES,
} from "../calculation.js";

// ---- Regles de quantite par defaut (section 6 de la specification) ----
// Ces regles sont appliquees quand les details ne les redefinissent pas.

const DEFAULT_RULES = {
  attentes_cv_fondation: {
    type: "Equerre",
    diametre: 10,
    dims: [50, 50],
    quantite_par_element: 4,
    designation: "Attentes CV fondation",
    nomenclature: "Equerre HA10 50x50",
  },
  attentes_pot1: {
    type: "Equerre",
    diametre: 12,
    dims: [50, 50],
    quantite_par_element: 6,
    designation: "Attentes Pot.1",
    nomenclature: "Equerre HA12 50x50",
  },
  attentes_pot2: {
    type: "Equerre",
    diametre: 12,
    dims: [50, 50],
    quantite_par_element: 10,
    designation: "Attentes Pot.2",
    nomenclature: "Equerre HA12 50x50",
  },
  liaison_angle_l: {
    type: "U",
    diametre: 10,
    dims: [50, 15, 50],
    quantite_par_jonction: 4,
    designation: "U liaison angle L",
    nomenclature: "U HA10 50x15x50",
  },
  liaison_angle_t: {
    type: "U",
    diametre: 10,
    dims: [50, 15, 50],
    quantite_par_jonction: 2,
    designation: "U liaison angle T",
    nomenclature: "U HA10 50x15x50",
  },
  equerres_angles: {
    type: "Equerre",
    diametre: 10,
    dims: [50, 50],
    quantite_par_jonction: 4,
    designation: "Equerres d'angles",
    nomenclature: "Equerre HA10 50x50",
  },
  liaison_linteau_cv: {
    type: "U",
    diametre: 10,
    dims: [50, 15, 50],
    quantite_par_jonction: 2,
    designation: "U liaison linteau/CV",
    nomenclature: "U HA10 50x15x50",
  },
  liaison_pot1_tete: {
    type: "U",
    diametre: 12,
    dims: [90, 9, 90],
    quantite_par_element: 2,
    designation: "U liaison Pot.1 en tete",
    nomenclature: "U HA12 90x9x90",
  },
  liaison_pot2_tete: {
    type: "U",
    diametre: 12,
    dims: [90, 9, 90],
    quantite_par_element: 5,
    designation: "U liaison Pot.2 en tete",
    nomenclature: "U HA12 90x9x90",
  },
};

// Hauteurs par defaut des elements ponctuels selon le niveau (en metres)
const HAUTEURS_DEFAUT = {
  Fondations: 0.50,
  "Haut VS": 1.00,
  "Haut RDC": 2.80,
  "Haut R+1": 2.80,
  "Haut R+2": 2.80,
};
const HAUTEUR_DEFAUT = 2.80;

// Longueur standard des elements lineaires (en metres)
const LONGUEUR_UNITE_LINEAIRE = 6.0;

// Elements qui ont des fiches de fabrication (poids deja connu)
const FABRICATION_REPERES = new Set([
  "Ptre_01", "Ptre_02", "Ptre_03", "Ptre_04", "Ptre_05",
  "Chev.1", "Chev.2",
]);

// ---- Point d'entree ----

export function assembleCarnet({ metadonnees, legendes, details, fiches, vision, hypotheses }) {
  const entete = {
    dossier: metadonnees?.dossier ?? "",
    chantier: metadonnees?.chantier ?? "",
    commune: metadonnees?.commune ?? "",
    zone_sismique: metadonnees?.zone_sismique ?? hypotheses?.zone_sismique ?? "",
  };

  // Construire les sections par niveau
  const niveaux = collectNiveaux(legendes, vision);
  const sections = [];

  for (const niveau of niveaux) {
    const section = buildSection(niveau, legendes, details, fiches, vision);
    if (section.lignes.length > 0) {
      sections.push(section);
    }
  }

  // Finaliser : calculer les totaux par section et le total general
  const finalSections = sections.map((s) => {
    const poids_section_kg = round2(
      s.lignes.reduce((acc, l) => acc + l.poids_total_kg, 0),
    );
    return { ...s, poids_section_kg };
  });

  const total_general_kg = round2(
    finalSections.reduce((acc, s) => acc + s.poids_section_kg, 0),
  );

  return { entete, sections: finalSections, total_general_kg };
}

// ---- Construction d'une section par niveau ----

function buildSection(niveau, legendes, details, fiches, vision) {
  const lignes = [];
  const legende = legendes[niveau];
  const visionData = vision[niveau];
  const hauteur = HAUTEURS_DEFAUT[niveau] ?? HAUTEUR_DEFAUT;

  // 1. STANDARD : cages d'armatures (depuis legende + comptages vision)
  if (legende?.armatures && visionData) {
    for (const arm of legende.armatures) {
      if (!arm.repere || FABRICATION_REPERES.has(arm.repere)) continue;
      const ligne = buildCageLine(arm, visionData, hauteur);
      if (ligne) lignes.push(ligne);
    }
  }

  // 2. COUPE FACONNE : attentes et liaisons (depuis details + comptages vision)
  if (visionData) {
    const coupeFaconne = buildCoupeFaconneLines(niveau, visionData, details);
    lignes.push(...coupeFaconne);
  }

  // 3. FABRICATION : elements avec fiche (poids depuis la fiche)
  const fichesNiveau = findFichesForNiveau(niveau, fiches);
  for (const [key, fiche] of fichesNiveau) {
    const qty = getVisionCount(visionData, fiche.repere);
    if (qty > 0 || fiche.poids_acier_kg > 0) {
      lignes.push({
        designation: fiche.repere || key,
        nomenclature: `Fiche ${fiche.repere} ${fiche.section || ""}`.trim(),
        type_armature: "FABRICATION",
        poids_unitaire_kg: round2(Number(fiche.poids_acier_kg) || 0),
        quantite: Math.max(qty, 1),
        poids_total_kg: round2((Number(fiche.poids_acier_kg) || 0) * Math.max(qty, 1)),
        detail_calcul: "Poids depuis fiche de fabrication",
        confiance: "HAUTE",
      });
    }
  }

  // 4. Attentes blocs a bancher (si fondations)
  if (niveau === "Fondations" || /fondation/i.test(niveau)) {
    const poidsABB = round2(poidsAttentesBlocsABancher());
    const sfCount = getLinearCount(visionData, "SF50") +
      getLinearCount(visionData, "SF50e");
    if (sfCount > 0) {
      lignes.push({
        designation: "Attentes blocs a bancher",
        nomenclature: "Module 2HA8 fil. + U HA8 esp.15",
        type_armature: "STANDARD",
        poids_unitaire_kg: poidsABB,
        quantite: sfCount,
        poids_total_kg: round2(poidsABB * sfCount),
        detail_calcul: `${sfCount} unites x ${poidsABB} kg`,
        confiance: "HAUTE",
      });
    }
  }

  return { section: niveau, lignes };
}

// ---- Construction d'une ligne de cage standard ----

function buildCageLine(arm, visionData, hauteur) {
  const repere = arm.repere;
  const isLinear = isLinearElement(repere);

  // Determiner la quantite depuis les comptages vision
  let quantite, longueur;
  if (isLinear) {
    quantite = getLinearCount(visionData, repere);
    longueur = LONGUEUR_UNITE_LINEAIRE;
  } else {
    quantite = getVisionCount(visionData, repere);
    longueur = hauteur;
  }

  if (quantite <= 0) return null;

  // Calculer le poids unitaire avec le moteur deterministe
  let poidsUnitaire;
  try {
    poidsUnitaire = poidsCageStandard({
      nbBarres: Number(arm.nb_barres) || 4,
      diametreBarreMm: Number(arm.diametre_barre) || 10,
      typeCadre: arm.type_transversal === "Ep" ? "Ep" : "Cad",
      diametreCadreMm: Number(arm.diametre_transversal) || 6,
      dim1CadreCm: Number(arm.dim1_transversal_cm) || 15,
      dim2CadreCm: Number(arm.dim2_transversal_cm) || 15,
      espacementCm: Number(arm.espacement_cm) || 20,
      longueurM: longueur,
    });
  } catch {
    return null;
  }
  poidsUnitaire = round2(poidsUnitaire);

  const nomenclature = formatNomenclature(arm);

  return {
    designation: repere,
    nomenclature,
    type_armature: "STANDARD",
    poids_unitaire_kg: poidsUnitaire,
    quantite,
    poids_total_kg: round2(poidsUnitaire * quantite),
    detail_calcul: `${quantite} x cage ${nomenclature} L=${longueur}m = ${round2(poidsUnitaire * quantite)} kg`,
    confiance: "HAUTE",
  };
}

// ---- Construction des lignes coupe faconne ----

function buildCoupeFaconneLines(niveau, visionData, details) {
  const lignes = [];
  const ponctuels = visionData?.elements_ponctuels ?? {};
  const angles = visionData?.angles ?? {};

  const cvCount = Number(ponctuels.CV) || 0;
  const pot1Count = Number(ponctuels["Pot.1"]) || 0;
  const pot2Count = Number(ponctuels["Pot.2"]) || 0;
  const anglesL = Number(angles.angles_L) || 0;
  const anglesT = Number(angles.angles_T) || 0;
  const jonctionsLtCV = Number(angles.jonctions_linteau_CV) || 0;

  // Attentes CV
  if (cvCount > 0) {
    const rule = DEFAULT_RULES.attentes_cv_fondation;
    const pU = round2(poidsEquerre(rule.diametre, ...rule.dims));
    const qte = cvCount * rule.quantite_par_element;
    lignes.push(makeCoupeFaconne(rule, pU, qte, `${cvCount} CV x ${rule.quantite_par_element}`));
  }

  // Attentes Pot.1
  if (pot1Count > 0) {
    const rule = DEFAULT_RULES.attentes_pot1;
    const pU = round2(poidsEquerre(rule.diametre, ...rule.dims));
    const qte = pot1Count * rule.quantite_par_element;
    lignes.push(makeCoupeFaconne(rule, pU, qte, `${pot1Count} Pot.1 x ${rule.quantite_par_element}`));

    // Liaison Pot.1 en tete
    const ruleTete = DEFAULT_RULES.liaison_pot1_tete;
    const pUT = round2(poidsU(ruleTete.diametre, ...ruleTete.dims));
    const qteT = pot1Count * ruleTete.quantite_par_element;
    lignes.push(makeCoupeFaconne(ruleTete, pUT, qteT, `${pot1Count} Pot.1 x ${ruleTete.quantite_par_element}`));
  }

  // Attentes Pot.2
  if (pot2Count > 0) {
    const rule = DEFAULT_RULES.attentes_pot2;
    const pU = round2(poidsEquerre(rule.diametre, ...rule.dims));
    const qte = pot2Count * rule.quantite_par_element;
    lignes.push(makeCoupeFaconne(rule, pU, qte, `${pot2Count} Pot.2 x ${rule.quantite_par_element}`));

    // Liaison Pot.2 en tete
    const ruleTete = DEFAULT_RULES.liaison_pot2_tete;
    const pUT = round2(poidsU(ruleTete.diametre, ...ruleTete.dims));
    const qteT = pot2Count * ruleTete.quantite_par_element;
    lignes.push(makeCoupeFaconne(ruleTete, pUT, qteT, `${pot2Count} Pot.2 x ${ruleTete.quantite_par_element}`));
  }

  // U liaison angles L
  if (anglesL > 0) {
    const rule = DEFAULT_RULES.liaison_angle_l;
    const pU = round2(poidsU(rule.diametre, ...rule.dims));
    const qte = anglesL * rule.quantite_par_jonction;
    lignes.push(makeCoupeFaconne(rule, pU, qte, `${anglesL} angles L x ${rule.quantite_par_jonction}`));

    // Equerres d'angles
    const ruleEq = DEFAULT_RULES.equerres_angles;
    const pUEq = round2(poidsEquerre(ruleEq.diametre, ...ruleEq.dims));
    const qteEq = anglesL * ruleEq.quantite_par_jonction;
    lignes.push(makeCoupeFaconne(ruleEq, pUEq, qteEq, `${anglesL} angles x ${ruleEq.quantite_par_jonction}`));
  }

  // U liaison angles T
  if (anglesT > 0) {
    const rule = DEFAULT_RULES.liaison_angle_t;
    const pU = round2(poidsU(rule.diametre, ...rule.dims));
    const qte = anglesT * rule.quantite_par_jonction;
    lignes.push(makeCoupeFaconne(rule, pU, qte, `${anglesT} angles T x ${rule.quantite_par_jonction}`));
  }

  // U liaison linteau/CV
  if (jonctionsLtCV > 0) {
    const rule = DEFAULT_RULES.liaison_linteau_cv;
    const pU = round2(poidsU(rule.diametre, ...rule.dims));
    const qte = jonctionsLtCV * rule.quantite_par_jonction;
    lignes.push(makeCoupeFaconne(rule, pU, qte, `${jonctionsLtCV} jonctions x ${rule.quantite_par_jonction}`));
  }

  return lignes;
}

function makeCoupeFaconne(rule, poidsUnitaire, quantite, detail) {
  return {
    designation: rule.designation,
    nomenclature: rule.nomenclature,
    type_armature: "COUPE FACONNE",
    poids_unitaire_kg: poidsUnitaire,
    quantite,
    poids_total_kg: round2(poidsUnitaire * quantite),
    detail_calcul: detail,
    confiance: "HAUTE",
  };
}

// ---- Helpers ----

function collectNiveaux(legendes, vision) {
  const order = ["Fondations", "Haut VS", "Haut RDC", "Haut R+1", "Haut R+2"];
  const all = new Set([...Object.keys(legendes || {}), ...Object.keys(vision || {})]);
  const sorted = [];
  for (const n of order) {
    if (all.has(n)) {
      sorted.push(n);
      all.delete(n);
    }
  }
  for (const n of all) sorted.push(n);
  return sorted;
}

function isLinearElement(repere) {
  return /^(SF|CH|CP)/i.test(repere);
}

function getVisionCount(visionData, repere) {
  if (!visionData) return 0;
  const p = visionData.elements_ponctuels;
  if (p && repere in p) return Math.max(0, Number(p[repere]) || 0);
  const lt = visionData.linteaux;
  if (lt && repere in lt) return Math.max(0, Number(lt[repere]) || 0);
  const ptr = visionData.poutres;
  if (ptr && repere in ptr) return Math.max(0, Number(ptr[repere]) || 0);
  return 0;
}

function getLinearCount(visionData, repere) {
  if (!visionData?.elements_lineaires) return 0;
  const el = visionData.elements_lineaires[repere];
  if (!el) return 0;
  return Math.max(0, Number(el.nb_unites_6m) || 0);
}

function findFichesForNiveau(niveau, fiches) {
  if (!fiches) return [];
  return Object.entries(fiches).filter(([key]) => {
    const parts = key.split("@");
    return parts.length >= 2 && matchNiveau(parts[1], niveau);
  });
}

function matchNiveau(ficheNiveau, sectionNiveau) {
  if (!ficheNiveau || !sectionNiveau) return false;
  const a = ficheNiveau.toLowerCase().replace(/\s+/g, "");
  const b = sectionNiveau.toLowerCase().replace(/\s+/g, "");
  return a === b || a.includes(b) || b.includes(a);
}

function formatNomenclature(arm) {
  const barres = `${arm.nb_barres || "?"}HA${arm.diametre_barre || "?"}`;
  const transType = arm.type_transversal === "Ep" ? "Ep" : "Cad";
  const trans = `${transType}.HA${arm.diametre_transversal || "?"} ${arm.dim1_transversal_cm || "?"}x${arm.dim2_transversal_cm || "?"}`;
  const esp = arm.espacement_cm ? ` esp.${arm.espacement_cm}` : "";
  return `${barres} ${trans}${esp}`;
}
