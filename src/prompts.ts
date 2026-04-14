// Prompts systeme et utilisateur - section 7 de la specification.

export const SYSTEM_REASONING =
  "Tu es un expert metreur en armatures beton arme chez Fimurex, specialise dans " +
  "la transformation d'Etudes BA en Carnets BA. Tu reponds TOUJOURS en JSON " +
  "valide, sans texte hors du JSON.";

export const SYSTEM_VISION =
  "Tu es un expert en lecture de plans de structure beton arme. Tu identifies " +
  "les elements structurels sur les plans, tu comptes et tu mesures en " +
  "utilisant l'echelle du cartouche. Tu reponds TOUJOURS en JSON valide.";

export function promptVisionPlan(niveau: string, legende: string, echelle: string): string {
  return `Analyse l'image ci-jointe qui est un plan de coffrage de niveau "${niveau}".

Legende du plan :
${legende}

Echelle : ${echelle}

Identifie et compte :
1. Elements ponctuels : CV, Pot.1, Pot.2, SI1, SI2, Chev.1, Att_CV.
2. Elements lineaires (longueur en m, nb unites de 6m) : SF50, SF50e, CH, CP, Lt1, Lt2, Lt2*, Lt3, Lt4, Lt4*, Ltvs, Ptre_01, Ptre_02.
3. Angles et jonctions : angles_L, angles_T, jonctions_linteau_CV.
4. Annotations : VR, PAF [{longueur_cm, ancrage_cm}], tremies [{dimensions}], hauteur_sous_plancher_m.

Reponds UNIQUEMENT en JSON selon le schema :
{
  "niveau": "${niveau}",
  "elements_ponctuels": {"CV": 0, "Pot.1": 0, "Pot.2": 0, "SI1": 0, "SI2": 0, "Chev.1": 0, "Att_CV": 0},
  "elements_lineaires": {"SF50": {"longueur_totale_m": 0, "nb_unites_6m": 0}, "SF50e": {"longueur_totale_m": 0, "nb_unites_6m": 0}, "CH": {"longueur_totale_m": 0, "nb_unites_6m": 0}, "CP": {"longueur_totale_m": 0, "nb_unites_6m": 0}, "Lt1": 0, "Lt2": 0, "Lt2*": 0, "Lt3": 0, "Lt4": 0, "Lt4*": 0, "Ltvs": 0, "Ptre_01": 0, "Ptre_02": 0},
  "angles": {"angles_L": 0, "angles_T": 0, "jonctions_linteau_CV": 0},
  "annotations": {"VR": 0, "PAF": [], "tremies": [], "hauteur_sous_plancher_m": 0}
}`;
}

export function promptExtractPageGarde(texte: string): string {
  return `Extrais les metadonnees de cette page de garde d'Etude BA :

TEXTE :
${texte}

Format JSON :
{"dossier": "", "chantier": "", "commune": "", "zone_sismique": "", "constructeur": "", "bet_sol": "", "date": ""}`;
}

export function promptExtractHypotheses(texte: string): string {
  return `Extrais les hypotheses de calcul :

TEXTE :
${texte}

Format :
{"fck_MPa": 0, "fyk_MPa": 0, "classe_ductilite": "", "enrobage_mm": 0, "recouvrement": "", "zone_sismique": "", "classe_sol": ""}`;
}

export function promptExtractLegende(texte: string): string {
  return `Extrais la legende des armatures de ce plan de coffrage :

TEXTE :
${texte}

Format :
{
  "niveau": "",
  "armatures": [
    {"repere": "", "description": "", "nb_barres": 0, "diametre_barre": 0, "type_transversal": "Cad|Ep", "diametre_transversal": 0, "dim1_transversal_cm": 0, "dim2_transversal_cm": 0, "espacement_cm": 0, "complements": ""}
  ]
}`;
}

export function promptExtractFiche(texte: string): string {
  return `Extrais cette fiche de fabrication :

TEXTE :
${texte}

Format :
{"repere": "", "niveau": "", "section": "", "poids_acier_kg": 0, "volume_beton_m3": 0, "positions": [{"pos": 0, "armature": "", "longueur_m": 0, "forme": ""}]}`;
}

export function promptExtractDetail(texte: string): string {
  return `Extrais les regles de ferraillage du detail :

TEXTE :
${texte}

Format :
{
  "element": "",
  "armature_principale": "",
  "attentes": [{"type": "Equerre|U|Crosse", "diametre": 0, "dimensions_cm": [], "espacement_cm": null, "quantite_par_element": 0}],
  "liaisons": [{"type": "U|Equerre|Barre", "diametre": 0, "dimensions_cm": [], "quantite_par_jonction": 0}],
  "renforts": [{"description": "", "condition": ""}]
}`;
}

export function promptAssembleCarnet(args: {
  metadonnees: string;
  legendes: string;
  details: string;
  fiches: string;
  comptages: string;
}): string {
  return `Produis le Carnet BA final a partir des donnees suivantes.

METADONNEES :
${args.metadonnees}

LEGENDES :
${args.legendes}

DETAILS :
${args.details}

FICHES DE FABRICATION :
${args.fiches}

COMPTAGES VISUELS :
${args.comptages}

MASSES LINEIQUES (kg/m) : HA5=0.154, HA6=0.222, HA8=0.395, HA10=0.617, HA12=0.888, HA14=1.208, HA16=1.578.

CLASSIFICATION :
- FABRICATION : elements avec fiche (poutres, poteaux, chevetres).
- COUPE FACONNE : equerres, U, crosses.
- STANDARD : cages d'armatures, barres simples, treillis soudes.

REGLES DE QUANTITES :
- Attentes CV fondation : 4 equerres HA10 par CV.
- Attentes poteaux : Pot.1 = 6 equerres HA12, Pot.2 = 10 equerres HA12.
- U liaison angle L : 4 par angle. U liaison angle T : 2 par angle.
- Equerres d'angles : 4 par angle.
- U liaison linteau/CV : 2 par jonction.
- Liaison poteau en tete : Pot.1 = 2 U HA12 90x9x90, Pot.2 = 5 U HA12 90x9x90.

Reponds au format JSON :
{
  "entete": {"dossier": "", "chantier": "", "commune": "", "zone_sismique": ""},
  "sections": [
    {
      "section": "FONDATIONS|HAUT VS|HAUT RDC|HAUT R+1",
      "lignes": [
        {"designation": "", "nomenclature": "", "type_armature": "STANDARD|COUPE FACONNE|FABRICATION", "poids_unitaire_kg": 0, "quantite": 0, "detail_calcul": "", "confiance": "HAUTE|MOYENNE|BASSE"}
      ]
    }
  ]
}

Les poids_total seront recalcules cote serveur. Veille a ce que poids_unitaire_kg soit coherent avec les masses lineiques.`;
}
