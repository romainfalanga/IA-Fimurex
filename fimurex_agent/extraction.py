"""Module 2 - Extraction textuelle structuree (Claude Opus 4.6)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

from .ingestion import IngestedPage
from .openrouter_client import OpenRouterClient, parse_json_response
from . import prompts


@dataclass
class ExtractedProject:
    metadonnees: Dict[str, Any] = field(default_factory=dict)
    hypotheses: Dict[str, Any] = field(default_factory=dict)
    # Legendes par niveau : "Fondations" -> {"niveau":..., "armatures":[...]}
    legendes_par_niveau: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    # Fiches de fabrication : (repere, niveau) -> fiche
    fiches: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    # Regles de detail constructif (par element)
    details: Dict[str, Dict[str, Any]] = field(default_factory=dict)


class ExtractionModule:
    """Orchestre l'extraction textuelle structuree page par page."""

    def __init__(self, client: OpenRouterClient):
        self.client = client

    def run(self, pages: List[IngestedPage]) -> ExtractedProject:
        project = ExtractedProject()

        for page in pages:
            if page.category == "PAGE_GARDE":
                project.metadonnees = self._extract(
                    prompts.PROMPT_EXTRACT_PAGE_GARDE.format(texte=page.text),
                    cache_key=f"garde_p{page.index:03d}",
                )

            elif page.category == "HYPOTHESES":
                project.hypotheses = self._extract(
                    prompts.PROMPT_EXTRACT_HYPOTHESES.format(texte=page.text),
                    cache_key=f"hypotheses_p{page.index:03d}",
                )

            elif page.category == "PLAN_COFFRAGE":
                legende = self._extract(
                    prompts.PROMPT_EXTRACT_LEGENDE.format(texte=page.text),
                    cache_key=f"legende_p{page.index:03d}",
                )
                niveau = legende.get("niveau") or page.niveau or f"page_{page.index}"
                project.legendes_par_niveau[niveau] = legende

            elif page.category == "FICHE_FABRICATION":
                fiche = self._extract(
                    prompts.PROMPT_EXTRACT_FICHE.format(texte=page.text),
                    cache_key=f"fiche_p{page.index:03d}",
                )
                repere = (fiche.get("repere") or page.repere or "?").replace(" ", "")
                niveau = fiche.get("niveau") or page.niveau or "?"
                project.fiches[f"{repere}@{niveau}"] = fiche

            elif page.category == "DETAIL":
                detail = self._extract(
                    prompts.PROMPT_EXTRACT_DETAIL.format(texte=page.text),
                    cache_key=f"detail_p{page.index:03d}",
                )
                element = detail.get("element") or f"detail_{page.index}"
                project.details[element] = detail

        return project

    # ----- internes ----------------------------------------------------

    def _extract(self, user_prompt: str, *, cache_key: str) -> Dict[str, Any]:
        raw = self.client.call_reasoning(
            system_prompt=prompts.SYSTEM_REASONING,
            user_prompt=user_prompt,
            cache_key=cache_key,
        )
        try:
            return parse_json_response(raw)
        except Exception:
            # On ne fait pas echouer le pipeline : on conserve la chaine brute.
            return {"_raw": raw}
