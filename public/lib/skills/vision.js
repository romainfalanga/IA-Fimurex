// ==========================================================================
// SKILL : Analyse visuelle des plans de coffrage — METRE-FIRST
// ==========================================================================
// L'IA mesure UNIQUEMENT des longueurs (metres) et compte des elements.
// Elle ne calcule JAMAIS de quantites ni de poids — c'est le code qui
// s'en charge via calculation.js (recouvrement, masses lineiques).
//
// Usage :
//   import { analyzePlan } from "./skills/vision.js";
//   const result = await analyzePlan(apiKey, imageDataUrl, "Haut RDC", legende);
// ==========================================================================

import { chat, parseJson } from "../openrouter.js";

const SYSTEM_VISION = `Tu es un expert en lecture de plans de structure beton arme. Tu identifies les elements structurels, tu les COMPTES et tu MESURES leurs longueurs en metres en utilisant l'echelle du cartouche. Tu reponds TOUJOURS en JSON valide, sans texte hors du JSON.

TRES IMPORTANT : tu ne dois JAMAIS calculer de quantites d'unites ni de poids. Tu dois uniquement MESURER des longueurs en metres et COMPTER des occurrences. Le calcul des quantites et poids sera fait par le code.

GUIDE VISUEL DES ELEMENTS SUR UN PLAN DE COFFRAGE :
- CV (Chainage Vertical) : petits carres ou rectangles marques "CV" aux intersections de murs.
- Pot (Poteau) : rectangles plus grands marques "Pot.1" ou "Pot.2", souvent avec des hachures.
- SI (Semelle Isolee) : rectangles sous les poteaux, marques "SI1" ou "SI2".
- SF (Semelle Filante) : lignes epaisses sous les murs, avec indication "SF50" ou "SF50e".
- CH (Chainage Horizontal) : lignes dans les murs, en trait pointille ou double trait.
- CP (Ceinture de Plancher) : lignes en peripherie du plancher.
- Lt (Linteau) : elements au-dessus des ouvertures (portes, fenetres), marques Lt1, Lt2, Lt3, Lt4.
- Angles L : jonctions a 90 degres entre deux murs (coin du batiment).
- Angles T : jonctions en T (un mur arrive perpendiculairement contre un autre).
- Jonctions linteau/CV : endroits ou un linteau rencontre un chainage vertical.`;

export async function analyzePlan(apiKey, imageDataUrl, niveau, legende) {
  const reperesList = buildReperesList(legende);
  const prompt = buildVisionPrompt(niveau, reperesList, legende);

  const raw = await chat({
    apiKey,
    system: SYSTEM_VISION,
    user: [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: imageDataUrl } },
    ],
    jsonResponse: true,
  });

  const parsed = safeParse(raw);
  return validateVisionResult(parsed, niveau);
}

function buildReperesList(legende) {
  if (!legende?.armatures?.length) {
    return "CV, Pot.1, Pot.2, SI1, SI2, Chev.1, SF50, SF50e, CH, CP, Lt1, Lt2, Lt3, Lt4, Ptre_01, Ptre_02";
  }
  const reperes = legende.armatures.map((a) => a.repere).filter(Boolean);
  const defaults = ["Att_CV", "VR"];
  return [...new Set([...reperes, ...defaults])].join(", ");
}

function buildVisionPrompt(niveau, reperesList, legende) {
  const legendeCtx = legende?.armatures?.length
    ? `\nLEGENDE EXTRAITE DU MEME PLAN (utilise-la pour identifier les reperes) :\n${JSON.stringify(legende.armatures, null, 2)}\n`
    : "";

  return `Analyse cette image qui est un plan de coffrage de niveau "${niveau}".
${legendeCtx}
ETAPE 1 — ECHELLE :
Lis l'echelle dans le cartouche du plan. Elle est indiquee sous la forme "Echelle : 1/XX", "Ech. 1/XX", ou "1:XX". Si tu ne la trouves pas, indique "non trouvee" et utilise 1/75 par defaut.

ETAPE 2 — ELEMENTS PONCTUELS (compter) :
Compte chaque element ponctuel visible : ${reperesList}.
Pour chaque element, indique le nombre EXACT d'occurrences. Si absent, mets 0.

ETAPE 3 — ELEMENTS LINEAIRES (mesurer en metres) :
Pour les elements lineaires (SF50, SF50e, CH, CP), MESURE la longueur totale en metres en utilisant l'echelle.
NE CALCULE PAS le nombre d'unites de 6m. Donne UNIQUEMENT la longueur mesuree en metres.
Exemple : si tu mesures un parcours total de SF50 de 42.5 metres, indique 42.5.

ETAPE 4 — LINTEAUX (compter) :
Compte chaque type de linteau (Lt1, Lt2, Lt2*, Lt3, Lt4, Lt4*, Ltvs).

ETAPE 5 — ANGLES ET JONCTIONS (compter) :
- angles_L : nombre de coins a 90 degres
- angles_T : nombre de jonctions en T
- jonctions_linteau_CV : nombre d'endroits ou un linteau touche un CV

ETAPE 6 — ANNOTATIONS :
- VR : nombre de voiles de refend
- PAF : porte-a-faux [{longueur_cm, ancrage_cm}]
- tremies : ouvertures [{dimensions}]
- hauteur_sous_plancher_m : hauteur libre sous plancher si indiquee (en metres)

Reponds UNIQUEMENT en JSON :
{
  "niveau": "${niveau}",
  "echelle_detectee": "1/XX",
  "confiance_echelle": "haute|moyenne|basse",
  "elements_ponctuels": {"CV": 0, "Pot.1": 0, "Pot.2": 0, "SI1": 0, "SI2": 0, "Chev.1": 0, "Att_CV": 0},
  "elements_lineaires": {
    "SF50": {"longueur_totale_m": 0},
    "SF50e": {"longueur_totale_m": 0},
    "CH": {"longueur_totale_m": 0},
    "CP": {"longueur_totale_m": 0}
  },
  "linteaux": {"Lt1": 0, "Lt2": 0, "Lt2*": 0, "Lt3": 0, "Lt4": 0, "Lt4*": 0, "Ltvs": 0},
  "poutres": {"Ptre_01": 0, "Ptre_02": 0},
  "angles": {"angles_L": 0, "angles_T": 0, "jonctions_linteau_CV": 0},
  "annotations": {"VR": 0, "PAF": [], "tremies": [], "hauteur_sous_plancher_m": 0}
}`;
}

function validateVisionResult(parsed, niveau) {
  if (!parsed || typeof parsed !== "object") {
    return { niveau, _error: "Vision parse failed" };
  }
  parsed.niveau = parsed.niveau || niveau;

  const intFields = ["elements_ponctuels", "linteaux", "poutres", "angles"];
  for (const field of intFields) {
    if (parsed[field] && typeof parsed[field] === "object") {
      for (const [k, v] of Object.entries(parsed[field])) {
        const num = Number(v);
        parsed[field][k] = Number.isFinite(num) && num >= 0 ? Math.round(num) : 0;
      }
    }
  }

  if (parsed.elements_lineaires) {
    for (const [, v] of Object.entries(parsed.elements_lineaires)) {
      if (v && typeof v === "object") {
        v.longueur_totale_m = Math.max(0, Number(v.longueur_totale_m) || 0);
      }
    }
  }

  return parsed;
}

function safeParse(raw) {
  try {
    return parseJson(raw);
  } catch {
    return null;
  }
}
