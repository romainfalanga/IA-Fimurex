"""Verifications automatiques du Carnet BA (section 10 de la specification)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from .calculation import CarnetBA, LigneCarnet
from .config import FOURCHETTES_COHERENCE


@dataclass
class Anomalie:
    severite: str  # "INFO" | "WARN" | "ERROR"
    message: str
    ligne: str = ""


@dataclass
class ValidationReport:
    anomalies: List[Anomalie] = field(default_factory=list)

    def add(self, severite: str, message: str, ligne: str = "") -> None:
        self.anomalies.append(Anomalie(severite=severite, message=message, ligne=ligne))

    @property
    def ok(self) -> bool:
        return not any(a.severite == "ERROR" for a in self.anomalies)


def validate_carnet(carnet: CarnetBA) -> ValidationReport:
    """Applique les verifications automatiques de la section 10.1."""
    report = ValidationReport()

    # 1. Verification arithmetique.
    for section in carnet.sections:
        for ligne in section.lignes:
            attendu = round(ligne.poids_unitaire_kg * ligne.quantite, 2)
            if abs(attendu - ligne.poids_total_kg) > 0.02:
                report.add(
                    "ERROR",
                    f"poids_total incoherent : {ligne.poids_total_kg} != "
                    f"{attendu} (={ligne.poids_unitaire_kg}*{ligne.quantite})",
                    ligne=ligne.designation,
                )

    somme = round(sum(s.poids_section_kg() for s in carnet.sections), 2)
    if abs(somme - carnet.total_general_kg()) > 0.02:
        report.add(
            "ERROR",
            f"Total general incoherent : {carnet.total_general_kg()} != {somme}",
        )

    # 2. Verification de coherence des poids unitaires (section 10.1).
    for section in carnet.sections:
        for ligne in section.lignes:
            fourchette = _fourchette_pour(ligne)
            if fourchette is None:
                continue
            mini, maxi = fourchette
            if not (mini <= ligne.poids_unitaire_kg <= maxi):
                report.add(
                    "WARN",
                    f"Poids unitaire {ligne.poids_unitaire_kg} kg hors fourchette "
                    f"attendue [{mini}; {maxi}]",
                    ligne=ligne.designation,
                )

    # 3. Verification de completude sommaire.
    if not carnet.sections:
        report.add("ERROR", "Aucune section dans le Carnet BA")

    return report


def _fourchette_pour(ligne: LigneCarnet):
    d = ligne.designation.lower()
    if d.startswith("cv"):
        return FOURCHETTES_COHERENCE["CV"]
    if d.startswith("ptre"):
        return FOURCHETTES_COHERENCE["Poutre"]
    if d.startswith("pot"):
        return FOURCHETTES_COHERENCE["Poteau"]
    if "equerre" in d or "equerres" in d:
        return FOURCHETTES_COHERENCE["Equerre"]
    if d.startswith("u ") or "u de liaison" in d:
        return FOURCHETTES_COHERENCE["U"]
    return None
