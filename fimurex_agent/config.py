"""Configuration globale du Fimurex AI Agent."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Dict


OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# Routage des modeles via OpenRouter. Voir section 3.1 de la specification.
MODELS: Dict[str, str] = {
    "vision": "google/gemini-2.5-pro",
    "reasoning": "anthropic/claude-opus-4.6",
}

# Masses lineiques normatives de l'acier HA (kg/m), densite 7850 kg/m3.
# Voir section 4.3 de la specification.
MASSES_LINEIQUES: Dict[int, float] = {
    5:  0.154,
    6:  0.222,
    8:  0.395,
    10: 0.617,
    12: 0.888,
    14: 1.208,
    16: 1.578,
    20: 2.466,
    25: 3.853,
    32: 6.313,
}

# Poids standards des treillis soudes courants (panneau 2.40m x 6.00m, kg).
# Voir section 4.4 de la specification.
POIDS_TREILLIS_SOUDES: Dict[str, float] = {
    "ST15C": 16.0,
    "ST20C": 22.0,
    "ST25C": 32.0,
    "ST40C": 86.98,  # valeur utilisee dans l'exemple de reference (cf. 6.2).
}

# Fourchettes de coherence pour la validation automatique (kg).
# Voir section 10.1 de la specification.
FOURCHETTES_COHERENCE: Dict[str, tuple[float, float]] = {
    "CV": (15.0, 25.0),
    "Poutre": (20.0, 150.0),
    "Poteau": (5.0, 50.0),
    "Equerre": (0.5, 3.0),
    "U": (0.5, 3.0),
}


@dataclass
class AgentConfig:
    """Configuration d'execution de l'agent."""

    openrouter_api_key: str = field(
        default_factory=lambda: os.environ.get("OPENROUTER_API_KEY", "")
    )
    base_url: str = OPENROUTER_BASE_URL
    model_vision: str = MODELS["vision"]
    model_reasoning: str = MODELS["reasoning"]
    temperature: float = 0.0  # Determinisme maximal pour les calculs.
    max_tokens: int = 16000
    request_timeout_s: int = 180

    # Dossier de cache pour reutiliser les resultats d'appels API.
    cache_dir: str = "cache"
    # Dossier de sortie pour le Carnet BA et les rapports.
    output_dir: str = "output"

    def ensure_valid(self) -> None:
        if not self.openrouter_api_key:
            raise RuntimeError(
                "OPENROUTER_API_KEY manquant. "
                "Definissez la variable d'environnement ou renseignez-la "
                "dans AgentConfig."
            )
