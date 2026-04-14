"""Module 4 - Moteur de calcul deterministe des poids.

Implemente les formules de la section 4.4/5.3 de la specification. Ces calculs
tournent en Python pur (pas d'appel LLM) pour garantir la reproductibilite et
la conformite stricte aux masses lineiques normatives.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Literal, Optional

from .config import MASSES_LINEIQUES, POIDS_TREILLIS_SOUDES


TypeArmature = Literal["STANDARD", "COUPE FACONNE", "FABRICATION"]


def _masse_lineique(diametre_mm: int) -> float:
    if diametre_mm not in MASSES_LINEIQUES:
        raise ValueError(
            f"Diametre HA{diametre_mm} inconnu. "
            f"Disponibles : {sorted(MASSES_LINEIQUES)}"
        )
    return MASSES_LINEIQUES[diametre_mm]


# ---------------------------------------------------------------------------
# Cage standard (CV, CH, Lt, SF, CP, Ltvs) - section 5.3
# ---------------------------------------------------------------------------

def poids_cage_standard(
    *,
    nb_barres: int,
    diametre_barre_mm: int,
    type_cadre: Literal["Cad", "Ep"],
    diametre_cadre_mm: int,
    dim1_cadre_cm: float,
    dim2_cadre_cm: float,
    espacement_cm: float,
    longueur_m: float,
) -> float:
    """Poids d'une cage d'armature lineaire (barres filantes + cadres/epingles).

    Formule : section 5.3 de la specification.
    - Crochets : 10 x diametre du cadre a chaque extremite.
    - nb_cadres = floor(longueur * 100 / espacement) + 1
    """
    masse_barre = _masse_lineique(diametre_barre_mm)
    masse_cadre = _masse_lineique(diametre_cadre_mm)

    poids_barres = nb_barres * longueur_m * masse_barre

    longueur_crochets_m = 2 * 10 * diametre_cadre_mm / 1000.0
    if type_cadre == "Cad":
        perimetre_m = 2 * (dim1_cadre_cm + dim2_cadre_cm) / 100.0
        longueur_cadre_m = perimetre_m + longueur_crochets_m
    elif type_cadre == "Ep":
        longueur_cadre_m = (2 * dim1_cadre_cm + dim2_cadre_cm) / 100.0 + longueur_crochets_m
    else:
        raise ValueError(f"type_cadre doit etre 'Cad' ou 'Ep', recu : {type_cadre}")

    nb_cadres = math.floor(longueur_m * 100.0 / espacement_cm) + 1
    poids_cadres = nb_cadres * longueur_cadre_m * masse_cadre

    return poids_barres + poids_cadres


# ---------------------------------------------------------------------------
# Pieces faconnees
# ---------------------------------------------------------------------------

def poids_equerre(*, diametre_mm: int, dim1_cm: float, dim2_cm: float) -> float:
    """Equerre (forme en L) : longueur developpee = branche1 + branche2."""
    longueur_m = (dim1_cm + dim2_cm) / 100.0
    return longueur_m * _masse_lineique(diametre_mm)


def poids_u(
    *, diametre_mm: int, dim1_cm: float, fond_cm: float, dim2_cm: float
) -> float:
    """U : longueur developpee = branche1 + fond + branche2."""
    longueur_m = (dim1_cm + fond_cm + dim2_cm) / 100.0
    return longueur_m * _masse_lineique(diametre_mm)


def poids_crosse(*, diametre_mm: int, dim1_cm: float, retour_cm: float) -> float:
    """Crosse : longueur developpee = partie droite + retour."""
    longueur_m = (dim1_cm + retour_cm) / 100.0
    return longueur_m * _masse_lineique(diametre_mm)


# ---------------------------------------------------------------------------
# Barre simple et treillis soude
# ---------------------------------------------------------------------------

def poids_barre_simple(*, diametre_mm: int, longueur_m: float) -> float:
    return longueur_m * _masse_lineique(diametre_mm)


def poids_treillis_soude(reference: str) -> float:
    if reference not in POIDS_TREILLIS_SOUDES:
        raise ValueError(
            f"Treillis soude {reference} non repertorie. "
            f"Disponibles : {sorted(POIDS_TREILLIS_SOUDES)}"
        )
    return POIDS_TREILLIS_SOUDES[reference]


# ---------------------------------------------------------------------------
# Attentes blocs a bancher (cas special utilise dans l'exemple)
# ---------------------------------------------------------------------------

def poids_attentes_blocs_a_bancher(
    *,
    nb_barres_filantes: int = 2,
    diametre_filant_mm: int = 8,
    diametre_u_mm: int = 8,
    dim1_u_cm: float = 70,
    fond_u_cm: float = 10,
    dim2_u_cm: float = 70,
    espacement_cm: float = 15,
    longueur_m: float = 4.00,
) -> float:
    """Module composite : 2 HA filants + U en attente tous les e=espacement.

    Reproduit le calcul de la ligne "Attentes blocs a bancher" du Carnet BA de
    reference (19.16 kg/u, voir section 6.2).
    """
    masse_filant = _masse_lineique(diametre_filant_mm)
    masse_u = _masse_lineique(diametre_u_mm)

    poids_filants = nb_barres_filantes * longueur_m * masse_filant
    longueur_u_m = (dim1_u_cm + fond_u_cm + dim2_u_cm) / 100.0
    nb_u = math.floor(longueur_m * 100.0 / espacement_cm) + 1
    poids_u_total = nb_u * longueur_u_m * masse_u

    return poids_filants + poids_u_total


# ---------------------------------------------------------------------------
# Structure d'une ligne du Carnet BA
# ---------------------------------------------------------------------------

@dataclass
class LigneCarnet:
    designation: str
    nomenclature: str
    type_armature: TypeArmature
    poids_unitaire_kg: float
    quantite: int
    detail_calcul: str = ""
    confiance: Literal["HAUTE", "MOYENNE", "BASSE"] = "MOYENNE"

    @property
    def poids_total_kg(self) -> float:
        return round(self.poids_unitaire_kg * self.quantite, 2)

    def to_dict(self) -> dict:
        return {
            "designation": self.designation,
            "nomenclature": self.nomenclature,
            "type_armature": self.type_armature,
            "poids_unitaire_kg": round(self.poids_unitaire_kg, 2),
            "quantite": self.quantite,
            "poids_total_kg": self.poids_total_kg,
            "detail_calcul": self.detail_calcul,
            "confiance": self.confiance,
        }


@dataclass
class SectionCarnet:
    nom: str  # "FONDATIONS" | "HAUT VS" | "HAUT RDC" | "HAUT R+1"
    lignes: List[LigneCarnet]

    def poids_section_kg(self) -> float:
        return round(sum(l.poids_total_kg for l in self.lignes), 2)

    def to_dict(self) -> dict:
        return {
            "section": self.nom,
            "lignes": [l.to_dict() for l in self.lignes],
            "poids_section_kg": self.poids_section_kg(),
        }


@dataclass
class CarnetBA:
    dossier: str
    chantier: str
    commune: str
    zone_sismique: str
    sections: List[SectionCarnet]

    def total_general_kg(self) -> float:
        return round(sum(s.poids_section_kg() for s in self.sections), 2)

    def to_dict(self) -> dict:
        return {
            "entete": {
                "dossier": self.dossier,
                "chantier": self.chantier,
                "commune": self.commune,
                "zone_sismique": self.zone_sismique,
            },
            "sections": [s.to_dict() for s in self.sections],
            "total_general_kg": self.total_general_kg(),
        }
