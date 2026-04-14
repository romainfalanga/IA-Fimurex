"""Orchestration du pipeline complet (sections 2.1 et 2.2)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from . import output
from .assembly import AssemblyModule
from .calculation import CarnetBA
from .config import AgentConfig
from .extraction import ExtractionModule, ExtractedProject
from .ingestion import ingest_pdf
from .openrouter_client import OpenRouterClient
from .validation import ValidationReport, validate_carnet
from .vision import VisionModule, VisionResults


@dataclass
class PipelineResult:
    carnet: CarnetBA
    extracted: ExtractedProject
    vision: VisionResults
    validation: ValidationReport


def run_pipeline(
    pdf_path: str,
    *,
    config: Optional[AgentConfig] = None,
    work_dir: str = "cache/work",
    dpi: int = 200,
) -> PipelineResult:
    """Execute les 4 modules sur un PDF d'Etude BA et produit le Carnet BA."""
    cfg = config or AgentConfig()
    cfg.ensure_valid()

    client = OpenRouterClient(cfg)

    # Module 1 : ingestion
    pages = ingest_pdf(pdf_path, work_dir=work_dir, dpi=dpi)

    # Module 2 : extraction textuelle (Claude Opus 4.6)
    extraction = ExtractionModule(client)
    project = extraction.run(pages)

    # Module 3 : analyse visuelle (Gemini)
    vision_module = VisionModule(client)
    vision_results = vision_module.run(pages, project.legendes_par_niveau)

    # Module 4 : assemblage (Claude Opus 4.6)
    assembly = AssemblyModule(client)
    carnet = assembly.run(project, vision_results)

    # Validation automatique
    validation = validate_carnet(carnet)

    return PipelineResult(
        carnet=carnet,
        extracted=project,
        vision=vision_results,
        validation=validation,
    )


def write_outputs(result: PipelineResult, output_dir: str) -> None:
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    output.save_json(result.carnet, str(out / "carnet_ba.json"))
    output.save_csv(result.carnet, str(out / "carnet_ba.csv"))
    try:
        output.save_pdf(result.carnet, str(out / "carnet_ba.pdf"))
    except Exception as err:  # reportlab optionnel
        (out / "carnet_ba.pdf.error").write_text(str(err), encoding="utf-8")
    output.save_report(result.validation, str(out / "rapport_traitement.md"))

    # Donnees intermediaires pour debug.
    (out / "extracted.json").write_text(
        json.dumps(
            {
                "metadonnees": result.extracted.metadonnees,
                "hypotheses": result.extracted.hypotheses,
                "legendes_par_niveau": result.extracted.legendes_par_niveau,
                "details": result.extracted.details,
                "fiches": result.extracted.fiches,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (out / "vision.json").write_text(
        json.dumps(result.vision.par_niveau, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
