// ==========================================================================
// SKILL : Extraction textuelle
// ==========================================================================
// Extrait des donnees structurees depuis le texte de chaque page du PDF.
// Chaque type de page a un prompt specialise avec le vocabulaire metier
// Fimurex et un schema JSON strict.
//
// Usage dans le pipeline :
//   import { extractPageGarde, extractLegende, ... } from "./skills/extraction.js";
//   const meta = await extractPageGarde(apiKey, pageText);
//
// Le modele (Gemini 2.0 Flash) ne fait QUE lire et structurer. Aucun
// calcul de poids ne lui est demande — les poids sont calcules en code
// par calculation.js.
// ==========================================================================

import { chat, parseJson } from "../openrouter.js";

// ---- Glossaire metier embarque dans chaque prompt ----

const GLOSSAIRE = `
GLOSSAIRE DES ABREVIATIONS :
- CV = Chainage Vertical (poteau en beton arme dans les murs)
- CH = Chainage Horizontal (ceinture horizontale dans les murs)
- SF = Semelle Filante (fondation lineaire sous les murs)
- SF50 = Semelle Filante largeur 50cm
- SF50e = Semelle Filante 50cm avec equerre de renfort
- CP = Ceinture de Plancher / Chainage Peripherique
- Lt = Linteau (poutre au-dessus d'une ouverture)
- Lt1, Lt2, Lt3, Lt4 = Linteaux de taille croissante
- Lt2*, Lt4* = Variantes renforcees de linteaux
- Ltvs = Linteau vide sanitaire
- Pot = Poteau (element vertical porteur isole)
- Pot.1, Pot.2 = Types de poteaux (Pot.2 plus gros que Pot.1)
- Ptre = Poutre (element horizontal porteur)
- Chev = Chevatre (poutre autour d'une tremie)
- SI = Semelle Isolee (fondation sous un poteau)
- SI1, SI2 = Semelles isolees de taille differente
- Att_CV = Attentes de chainage vertical (barres en attente)
- VR = Voile de Refend (mur porteur interieur)
- PAF = Porte-A-Faux (dalle en saillie)
- VS = Vide Sanitaire
- RDC = Rez-De-Chaussee
- HA = Haute Adherence (type d'acier pour beton arme)
- HA6, HA8, HA10, HA12, HA14, HA16 = Diametres standard en mm
- Cad = Cadre (armature transversale fermee rectangulaire)
- Ep = Epingle (armature transversale ouverte en U)
- esp. = Espacement entre cadres/epingles

NOTATION DES ARMATURES :
- "4HA10" = 4 barres de diametre 10mm
- "Cad.HA6 15x25 esp.20" = Cadres en HA6, section 15cm x 25cm, espaces de 20cm
- "Ep.HA6 15x25 esp.20" = Epingles en HA6, section 15cm x 25cm, espaces de 20cm
`;

const SYSTEM = `Tu es un assistant specialise dans la lecture de documents techniques de beton arme (Etudes BA) pour le groupe Fimurex. Tu extrais des donnees structurees depuis le texte brut de chaque page. Tu reponds TOUJOURS en JSON valide, sans texte avant ni apres le JSON. Si un champ est absent du texte, mets une chaine vide ou 0 selon le type.

${GLOSSAIRE}`;

// ---- Extraction : Page de garde ----

export async function extractPageGarde(apiKey, text) {
  const raw = await chat({
    apiKey,
    system: SYSTEM,
    user: `Extrais les metadonnees de cette page de garde d'une Etude BA.

Le texte peut contenir des informations reparties dans un cartouche ou un tableau. Cherche specifiquement :
- Le numero de dossier (souvent en haut, format XX.XX.XX ou XXXXX)
- Le nom du chantier / projet (nom de la construction)
- La commune / ville
- La zone sismique (1 a 5, ou "faible", "moderee", etc.)
- Le constructeur / maitre d'ouvrage
- Le bureau d'etudes sol (BE sol)
- La date du document

TEXTE DE LA PAGE :
${text}

Reponds en JSON :
{"dossier": "", "chantier": "", "commune": "", "zone_sismique": "", "constructeur": "", "bet_sol": "", "date": ""}`,
    jsonResponse: true,
  });
  return safeParseOrDefault(raw, {
    dossier: "",
    chantier: "",
    commune: "",
    zone_sismique: "",
    constructeur: "",
    bet_sol: "",
    date: "",
  });
}

// ---- Extraction : Hypotheses ----

export async function extractHypotheses(apiKey, text) {
  const raw = await chat({
    apiKey,
    system: SYSTEM,
    user: `Extrais les hypotheses de calcul de cette page d'Etude BA.

Cherche specifiquement :
- fck (resistance beton) en MPa (souvent 25 ou 30)
- fyk (limite elastique acier) en MPa (souvent 500)
- classe de ductilite (A, B ou C)
- enrobage en mm (souvent 25, 30 ou 40)
- longueur de recouvrement (souvent exprimee en nb de diametres, ex: "40d")
- zone sismique (1 a 5)
- classe de sol (A, B, C, D ou E)

TEXTE DE LA PAGE :
${text}

Reponds en JSON :
{"fck_MPa": 0, "fyk_MPa": 0, "classe_ductilite": "", "enrobage_mm": 0, "recouvrement": "", "zone_sismique": "", "classe_sol": ""}`,
    jsonResponse: true,
  });
  return safeParseOrDefault(raw, {
    fck_MPa: 0,
    fyk_MPa: 0,
    classe_ductilite: "",
    enrobage_mm: 0,
    recouvrement: "",
    zone_sismique: "",
    classe_sol: "",
  });
}

// ---- Extraction : Legende de plan de coffrage ----

export async function extractLegende(apiKey, text) {
  const raw = await chat({
    apiKey,
    system: SYSTEM,
    user: `Extrais la legende des armatures de ce plan de coffrage.

La legende liste les differents types d'armatures utilises dans le plan. Chaque ligne de legende decrit un element structurel (CV, SF50, CH, Lt, Pot, etc.) avec sa composition :
- repere : code de l'element (CV, SF50, CH, Lt1, Pot.1, etc.)
- description : texte descriptif
- nb_barres : nombre de barres longitudinales (filantes)
- diametre_barre : diametre des barres longitudinales en mm (6, 8, 10, 12, 14, 16)
- type_transversal : "Cad" pour cadre ferme, "Ep" pour epingle ouverte
- diametre_transversal : diametre des cadres/epingles en mm
- dim1_transversal_cm : premiere dimension du cadre en cm (largeur)
- dim2_transversal_cm : deuxieme dimension du cadre en cm (hauteur)
- espacement_cm : espacement entre cadres/epingles en cm
- complements : tout texte supplementaire (renforts, notes)

Exemples de notation legende :
- "CV : 4HA10 Cad.HA6 15x15 esp.20" → repere=CV, nb_barres=4, diametre_barre=10, type_transversal=Cad, diametre_transversal=6, dim1=15, dim2=15, esp=20
- "SF50 : 5HA10 Ep.HA6 25x50 esp.20" → repere=SF50, nb_barres=5, diametre_barre=10, type_transversal=Ep, diametre_transversal=6, dim1=25, dim2=50, esp=20

Le texte peut aussi indiquer le niveau (Fondations, Haut VS, Haut RDC, Haut R+1, etc.).

TEXTE DE LA PAGE :
${text}

Reponds en JSON :
{
  "niveau": "",
  "armatures": [
    {"repere": "", "description": "", "nb_barres": 0, "diametre_barre": 0, "type_transversal": "Cad", "diametre_transversal": 0, "dim1_transversal_cm": 0, "dim2_transversal_cm": 0, "espacement_cm": 0, "complements": ""}
  ]
}`,
    jsonResponse: true,
  });

  const parsed = safeParseOrDefault(raw, { niveau: "", armatures: [] });
  // Validate armatures: filter out entries with missing critical fields
  if (Array.isArray(parsed.armatures)) {
    parsed.armatures = parsed.armatures.filter(
      (a) => a.repere && a.diametre_barre > 0,
    );
  }
  return parsed;
}

// ---- Extraction : Fiche de fabrication ----

export async function extractFiche(apiKey, text) {
  const raw = await chat({
    apiKey,
    system: SYSTEM,
    user: `Extrais les donnees de cette fiche de fabrication d'armatures.

Une fiche de fabrication decrit un element structurel fabrique en usine (poutre, poteau, chevatre). Elle contient :
- repere : code de l'element (Ptre_01, Pot.1, Chev.1, etc.)
- niveau : le niveau du batiment (Fondations, Haut VS, Haut RDC, Haut R+1)
- section : dimensions de la section en cm (ex: "20x40")
- poids_acier_kg : poids total d'acier indique sur la fiche
- volume_beton_m3 : volume de beton indique
- positions : liste des positions d'armatures avec :
  - pos : numero de position
  - armature : description (ex: "HA12 L=3.20")
  - longueur_m : longueur de la barre en metres
  - forme : forme de la barre (droite, equerre, U, cadre, etc.)

TEXTE DE LA PAGE :
${text}

Reponds en JSON :
{"repere": "", "niveau": "", "section": "", "poids_acier_kg": 0, "volume_beton_m3": 0, "positions": [{"pos": 0, "armature": "", "longueur_m": 0, "forme": ""}]}`,
    jsonResponse: true,
  });
  return safeParseOrDefault(raw, {
    repere: "",
    niveau: "",
    section: "",
    poids_acier_kg: 0,
    volume_beton_m3: 0,
    positions: [],
  });
}

// ---- Extraction : Detail de ferraillage ----

export async function extractDetail(apiKey, text) {
  const raw = await chat({
    apiKey,
    system: SYSTEM,
    user: `Extrais les regles de ferraillage de ce detail constructif.

Un detail definit les regles d'attentes et de liaisons pour un type d'element. Il specifie :
- element : quel element est concerne (CV, Poteaux, Linteaux, Angles, etc.)
- armature_principale : armature longitudinale de base
- attentes : barres en attente pour la continuite entre niveaux
  - type : Equerre (en L), U (en U), Crosse (barre coudee)
  - diametre : diametre en mm
  - dimensions_cm : dimensions [branche1, branche2] ou [branche1, fond, branche2]
  - espacement_cm : si les attentes sont espacees regulierement
  - quantite_par_element : nombre d'attentes par element
- liaisons : pieces de liaison aux jonctions entre elements
  - type : U, Equerre, Barre
  - diametre : diametre en mm
  - dimensions_cm : dimensions
  - quantite_par_jonction : nombre par jonction
- renforts : renforts conditionnels (ex: "renfort HA12 si portee > 3m")

TEXTE DE LA PAGE :
${text}

Reponds en JSON :
{
  "element": "",
  "armature_principale": "",
  "attentes": [{"type": "Equerre", "diametre": 0, "dimensions_cm": [], "espacement_cm": null, "quantite_par_element": 0}],
  "liaisons": [{"type": "U", "diametre": 0, "dimensions_cm": [], "quantite_par_jonction": 0}],
  "renforts": [{"description": "", "condition": ""}]
}`,
    jsonResponse: true,
  });
  return safeParseOrDefault(raw, {
    element: "",
    armature_principale: "",
    attentes: [],
    liaisons: [],
    renforts: [],
  });
}

// ---- Helpers ----

function safeParseOrDefault(raw, defaultValue) {
  try {
    return parseJson(raw);
  } catch {
    return { ...defaultValue, _raw: raw };
  }
}
