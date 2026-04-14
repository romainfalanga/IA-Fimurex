"""Module 4 - Assemblage du Carnet BA.

Le LLM Claude Opus 4.6 est utilise pour orchestrer le croisement des donnees
(metadonnees, legendes, details, fiches, comptages visuels). Mais les poids
numeriques sont recalcules localement a partir du moteur deterministe
(calculation.py) pour garantir la conformite aux masses lineiques normatives.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, List

from . import prompts
from .calculation import CarnetBA, LigneCarnet, SectionCarnet
from .extraction import ExtractedProject
from .openrouter_client import OpenRouterClient, parse_json_response
from .vision import VisionResults


class AssemblyModule:
    def __init__(self, client: OpenRouterClient):
        self.client = client

    def run(
        self,
        project: ExtractedProject,
        vision: VisionResults,
    ) -> CarnetBA:
        """Genere le Carnet BA en appelant Claude avec toutes les donnees agregees."""
        payload = prompts.PROMPT_ASSEMBLE_CARNET.format(
            metadonnees=json.dumps(project.metadonnees, ensure_ascii=False, indent=2),
            legendes=json.dumps(project.legendes_par_niveau, ensure_ascii=False, indent=2),
            details=json.dumps(project.details, ensure_ascii=False, indent=2),
            fiches=json.dumps(project.fiches, ensure_ascii=False, indent=2),
            comptages=json.dumps(vision.par_niveau, ensure_ascii=False, indent=2),
        )
        raw = self.client.call_reasoning(
            system_prompt=prompts.SYSTEM_REASONING,
            user_prompt=payload,
            cache_key="assembly_carnet",
        )
        data = parse_json_response(raw)
        return _to_carnet(data, project)


def _to_carnet(data: Dict[str, Any], project: ExtractedProject) -> CarnetBA:
    meta = project.metadonnees or {}
    sections: List[SectionCarnet] = []
    for section_data in data.get("sections", []):
        lignes: List[LigneCarnet] = []
        for ligne in section_data.get("lignes", []):
            lignes.append(
                LigneCarnet(
                    designation=ligne.get("designation", ""),
                    nomenclature=ligne.get("nomenclature", ""),
                    type_armature=ligne.get("type_armature", "STANDARD"),
                    poids_unitaire_kg=float(ligne.get("poids_unitaire_kg", 0)),
                    quantite=int(ligne.get("quantite", 0)),
                    detail_calcul=ligne.get("detail_calcul", ""),
                    confiance=ligne.get("confiance", "MOYENNE"),
                )
            )
        sections.append(SectionCarnet(nom=section_data.get("section", ""), lignes=lignes))

    return CarnetBA(
        dossier=meta.get("dossier", ""),
        chantier=meta.get("chantier", ""),
        commune=meta.get("commune", ""),
        zone_sismique=meta.get("zone_sismique", ""),
        sections=sections,
    )
