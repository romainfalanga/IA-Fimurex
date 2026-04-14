"""Point d'entree CLI du Fimurex AI Agent.

Exemples :
  python -m fimurex_agent chemin/vers/etude_ba.pdf --output output/
  python -m fimurex_agent etude.pdf --dpi 300 --output ./carnets/
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .config import AgentConfig
from .pipeline import run_pipeline, write_outputs


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Fimurex AI Agent : transformation Etude BA -> Carnet BA.",
    )
    parser.add_argument("pdf", help="Chemin vers le PDF de l'Etude BA.")
    parser.add_argument(
        "--output", "-o", default="output",
        help="Dossier de sortie (defaut: output/).",
    )
    parser.add_argument(
        "--cache", default="cache",
        help="Dossier de cache pour les appels OpenRouter (defaut: cache/).",
    )
    parser.add_argument(
        "--dpi", type=int, default=200,
        help="Resolution de conversion PDF -> image (defaut: 200).",
    )
    parser.add_argument(
        "--api-key", default=None,
        help="Clef OpenRouter (sinon utilise OPENROUTER_API_KEY).",
    )
    args = parser.parse_args(argv)

    if not Path(args.pdf).exists():
        print(f"Fichier introuvable : {args.pdf}", file=sys.stderr)
        return 2

    cfg = AgentConfig()
    if args.api_key:
        cfg.openrouter_api_key = args.api_key
    cfg.output_dir = args.output
    cfg.cache_dir = args.cache

    result = run_pipeline(args.pdf, config=cfg, work_dir=f"{args.cache}/work", dpi=args.dpi)
    write_outputs(result, args.output)

    print(f"Carnet BA genere : {args.output}/carnet_ba.csv")
    print(f"Total general : {result.carnet.total_general_kg():.2f} kg")
    if not result.validation.ok:
        print(
            f"ATTENTION : {len(result.validation.anomalies)} anomalie(s) detectee(s). "
            f"Voir {args.output}/rapport_traitement.md",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
