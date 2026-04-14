"""Prompts systeme et utilisateur pour les appels OpenRouter.

Les templates suivent fidelement les sections 7.1, 7.2 et 7.3 de la specification.
"""

from __future__ import annotations


SYSTEM_REASONING = (
    "Tu es un expert metreur en armatures beton arme chez Fimurex, specialise dans "
    "la transformation d'Etudes BA en Carnets BA. Tu reponds TOUJOURS en JSON "
    "valide, sans texte hors du JSON."
)

SYSTEM_VISION = (
    "Tu es un expert en lecture de plans de structure beton arme. Tu identifies "
    "les elements structurels sur les plans, tu comptes et tu mesures en "
    "utilisant l'echelle du cartouche. Tu reponds TOUJOURS en JSON valide."
)


# --- 7.1 Prompt Gemini : analyse visuelle d'un plan de coffrage -----------

PROMPT_VISION_PLAN = """\
Analyse l'image ci-jointe qui est un plan de coffrage de niveau "{niveau}".

Voici la legende du plan :
{legende}

Echelle du plan : {echelle}

Tu dois identifier et compter TOUS les elements suivants sur le plan :

1. ELEMENTS PONCTUELS (compte chaque occurrence) :
   - CV (chainages verticaux) : symbole "CV" sur le plan
   - Poteaux : "Pot.1", "Pot.2", etc.
   - Semelles isolees : "SI1", "SI2", etc.
   - Chevetres : "Chev.1", etc.

2. ELEMENTS LINEAIRES (mesure la longueur totale en utilisant l'echelle) :
   - Semelles filantes : "SF50", "SF50e"
   - Chainages horizontaux : "CH"
   - Chainage pignon : "CP"
   - Linteaux par type : "Lt1", "Lt2", "Lt2*", "Lt3", "Lt4", "Lt4*"
   - Poutres : "Ptre 01", "Ptre 02"
   - Linteaux VS : "Ltvs"

3. ANGLES ET JONCTIONS :
   - Nombre d'angles en L
   - Nombre d'angles en T
   - Nombre de jonctions linteau/CV
   - Nombre d'annotations "VR" (volet roulant)
   - Nombre d'attentes CV ("Att. CV")

4. ANNOTATIONS SPECIALES :
   - Porte-a-faux (PAF/PaF) et dimensions
   - Tremies et dimensions
   - Retombees de poutres
   - Hauteur sous plancher

Reponds UNIQUEMENT au format JSON :
{{
  "niveau": "{niveau}",
  "elements_ponctuels": {{
    "CV": 0, "Pot.1": 0, "Pot.2": 0, "SI1": 0, "SI2": 0, "Chev.1": 0, "Att_CV": 0
  }},
  "elements_lineaires": {{
    "SF50":  {{"longueur_totale_m": 0.0, "nb_unites_6m": 0}},
    "SF50e": {{"longueur_totale_m": 0.0, "nb_unites_6m": 0}},
    "CH":    {{"longueur_totale_m": 0.0, "nb_unites_6m": 0}},
    "CP":    {{"longueur_totale_m": 0.0, "nb_unites_6m": 0}},
    "Lt1": 0, "Lt2": 0, "Lt2*": 0, "Lt3": 0, "Lt4": 0, "Lt4*": 0, "Ltvs": 0,
    "Ptre_01": 0, "Ptre_02": 0
  }},
  "angles": {{
    "angles_L": 0, "angles_T": 0, "jonctions_linteau_CV": 0
  }},
  "annotations": {{
    "VR": 0,
    "PAF": [],
    "tremies": [],
    "hauteur_sous_plancher_m": 0.0
  }}
}}
"""


# --- 7.2 Prompts Claude : extraction textuelle structuree -----------------

PROMPT_EXTRACT_PAGE_GARDE = """\
Extrais les metadonnees de cette page de garde d'Etude BA et reponds en JSON :

TEXTE :
{texte}

Format :
{{
  "dossier": "<numero>",
  "chantier": "<nom>",
  "commune": "<ville (code_postal)>",
  "zone_sismique": "<zone - description>",
  "constructeur": "<nom>",
  "bet_sol": "<nom>",
  "date": "<date>"
}}
"""

PROMPT_EXTRACT_HYPOTHESES = """\
Extrais les hypotheses de calcul de cette page et reponds en JSON :

TEXTE :
{texte}

Format :
{{
  "fck_MPa": 0,
  "fyk_MPa": 0,
  "classe_ductilite": "",
  "enrobage_mm": 0,
  "recouvrement": "",
  "zone_sismique": "",
  "classe_sol": ""
}}
"""

PROMPT_EXTRACT_LEGENDE = """\
Extrais la legende des armatures de ce plan de coffrage et reponds en JSON.

TEXTE :
{texte}

Format :
{{
  "niveau": "<nom_du_niveau>",
  "armatures": [
    {{
      "repere": "<repere>",
      "description": "<description complete>",
      "nb_barres": 0,
      "diametre_barre": 0,
      "type_transversal": "Cad|Ep|null",
      "diametre_transversal": 0,
      "dim1_transversal_cm": 0,
      "dim2_transversal_cm": 0,
      "espacement_cm": 0,
      "complements": ""
    }}
  ]
}}
"""

PROMPT_EXTRACT_FICHE = """\
Extrais les informations de cette fiche de fabrication et reponds en JSON.

TEXTE :
{texte}

Format :
{{
  "repere": "<Ptre 01|Pot.1|Chev.1|...>",
  "niveau": "<Fondations|Haut VS|Haut RDC|Haut R+1>",
  "section": "<LxH>",
  "poids_acier_kg": 0.0,
  "volume_beton_m3": 0.0,
  "positions": [
    {{"pos": 0, "armature": "", "longueur_m": 0.0, "forme": ""}}
  ]
}}
"""

PROMPT_EXTRACT_DETAIL = """\
Extrais les regles de ferraillage decrites dans cette page de detail constructif.

TEXTE :
{texte}

Format :
{{
  "element": "<nom_element>",
  "armature_principale": "<description>",
  "attentes": [
    {{"type": "Equerre|U|Crosse", "diametre": 0, "dimensions_cm": [], "espacement_cm": null, "quantite_par_element": 0}}
  ],
  "liaisons": [
    {{"type": "U|Equerre|Barre", "diametre": 0, "dimensions_cm": [], "quantite_par_jonction": 0}}
  ],
  "renforts": [
    {{"description": "", "condition": ""}}
  ]
}}
"""


# --- 7.3 Prompt Claude : assemblage du Carnet BA --------------------------

PROMPT_ASSEMBLE_CARNET = """\
Tu dois produire le Carnet BA final a partir des donnees ci-dessous.

METADONNEES PROJET :
{metadonnees}

LEGENDES PAR NIVEAU :
{legendes}

DETAILS CONSTRUCTIFS :
{details}

FICHES DE FABRICATION :
{fiches}

COMPTAGES VISUELS PAR NIVEAU :
{comptages}

MASSES LINEIQUES (kg/m) :
HA5=0.154, HA6=0.222, HA8=0.395, HA10=0.617, HA12=0.888, HA14=1.208, HA16=1.578

REGLES DE CLASSIFICATION :
- FABRICATION : elements avec fiche (poutres, poteaux, chevetres)
- COUPE FACONNE : equerres, U, crosses
- STANDARD : cages d'armatures, barres simples, treillis soudes

REGLES DE QUANTITES POUR LES LIAISONS :
- Attentes CV en fondation : 4 equerres HA10 par CV
- Attentes poteaux : Pot.1 = 6 equerres HA12, Pot.2 = 10 equerres HA12
- U de liaison d'angles en L : 4 U par angle
- U de liaison d'angles en T : 2 U par angle
- Equerres d'angles : 4 equerres par angle
- U de liaison linteau/CV : 2 U par jonction
- Liaison poteau en tete : Pot.1 = 2 U HA12 90x9x90, Pot.2 = 5 U HA12 90x9x90

Pour chaque section (FONDATIONS, HAUT VS, HAUT RDC, HAUT R+1), produis :
{{
  "section": "<nom>",
  "lignes": [
    {{
      "designation": "<repere>",
      "nomenclature": "<description technique>",
      "type_armature": "STANDARD|COUPE FACONNE|FABRICATION",
      "poids_unitaire_kg": 0.00,
      "quantite": 0,
      "poids_total_kg": 0.00,
      "detail_calcul": "<explication>",
      "confiance": "HAUTE|MOYENNE|BASSE"
    }}
  ]
}}

Reponds par le JSON complet :
{{
  "sections": [...],
  "total_general_kg": 0.00
}}

Verifie que chaque poids_total = poids_unitaire * quantite et que le total
general est la somme exacte de tous les poids_total.
"""
