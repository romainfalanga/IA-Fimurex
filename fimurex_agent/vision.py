"""Module 3 - Analyse visuelle des plans (Gemini via OpenRouter)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .ingestion import IngestedPage
from .openrouter_client import OpenRouterClient, parse_json_response
from . import prompts


@dataclass
class VisionResults:
    """Agregation des comptages visuels par niveau."""

    par_niveau: Dict[str, Dict[str, Any]] = field(default_factory=dict)


class VisionModule:
    """Orchestre l'analyse multimodale page a page."""

    def __init__(self, client: OpenRouterClient):
        self.client = client

    def run(
        self,
        pages: List[IngestedPage],
        legendes_par_niveau: Optional[Dict[str, Dict[str, Any]]] = None,
        *,
        echelle: str = "1/75",
    ) -> VisionResults:
        legendes_par_niveau = legendes_par_niveau or {}
        results = VisionResults()

        for page in pages:
            if page.category != "PLAN_COFFRAGE":
                continue

            niveau = page.niveau or f"page_{page.index}"
            legende = legendes_par_niveau.get(niveau, {})
            legende_texte = json.dumps(legende, ensure_ascii=False, indent=2)

            user_prompt = prompts.PROMPT_VISION_PLAN.format(
                niveau=niveau,
                legende=legende_texte,
                echelle=echelle,
            )
            raw = self.client.call_vision(
                system_prompt=prompts.SYSTEM_VISION,
                user_prompt=user_prompt,
                image_path=page.image_path,
                cache_key=f"vision_{niveau.replace(' ', '_')}_p{page.index:03d}",
            )
            try:
                parsed = parse_json_response(raw)
            except Exception:
                parsed = {"_raw": raw}

            results.par_niveau[niveau] = parsed

        return results
