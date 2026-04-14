"""Formats de sortie du Carnet BA : CSV, JSON, PDF (section 9)."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import List

from .calculation import CarnetBA
from .validation import ValidationReport


CSV_COLUMNS = [
    "Section",
    "Designation",
    "Nomenclature",
    "Type d'armature",
    "Poids/u (kg)",
    "Quantite",
    "Poids (kg)",
]


def save_json(carnet: CarnetBA, path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(
        json.dumps(carnet.to_dict(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def save_csv(carnet: CarnetBA, path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh, delimiter=";")
        writer.writerow(CSV_COLUMNS)
        for section in carnet.sections:
            for ligne in section.lignes:
                writer.writerow(
                    [
                        section.nom,
                        ligne.designation,
                        ligne.nomenclature,
                        ligne.type_armature,
                        f"{ligne.poids_unitaire_kg:.2f}",
                        ligne.quantite,
                        f"{ligne.poids_total_kg:.2f}",
                    ]
                )
        writer.writerow([])
        writer.writerow(["TOTAL GENERAL", "", "", "", "", "", f"{carnet.total_general_kg():.2f}"])


def save_pdf(carnet: CarnetBA, path: str) -> None:
    """Genere un PDF reproduisant visuellement le Carnet BA."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    )

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()

    doc = SimpleDocTemplate(path, pagesize=landscape(A4))
    story = []
    title = (
        f"<b>CARNET BA</b> &mdash; Dossier {carnet.dossier} &mdash; "
        f"{carnet.chantier} ({carnet.commune}) &mdash; Zone sismique {carnet.zone_sismique}"
    )
    story.append(Paragraph(title, styles["Title"]))
    story.append(Spacer(1, 12))

    for section in carnet.sections:
        story.append(Paragraph(f"<b>{section.nom}</b>", styles["Heading2"]))
        data = [CSV_COLUMNS[1:]]  # sans "Section"
        for ligne in section.lignes:
            data.append(
                [
                    ligne.designation,
                    ligne.nomenclature,
                    ligne.type_armature,
                    f"{ligne.poids_unitaire_kg:.2f}",
                    str(ligne.quantite),
                    f"{ligne.poids_total_kg:.2f}",
                ]
            )
        table = Table(data, repeatRows=1)
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                    ("GRID", (0, 0), (-1, -1), 0.3, colors.grey),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("ALIGN", (3, 1), (-1, -1), "RIGHT"),
                ]
            )
        )
        story.append(table)
        story.append(Spacer(1, 12))

    story.append(
        Paragraph(
            f"<b>TOTAL GENERAL : {carnet.total_general_kg():.2f} kg</b>",
            styles["Heading2"],
        )
    )
    doc.build(story)


def save_report(report: ValidationReport, path: str) -> None:
    """Rapport de traitement au format texte (section 10.3)."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    lines: List[str] = ["# Rapport de traitement Fimurex AI Agent", ""]
    if not report.anomalies:
        lines.append("Aucune anomalie detectee.")
    else:
        for a in report.anomalies:
            prefix = f"[{a.severite}]"
            if a.ligne:
                prefix += f" ({a.ligne})"
            lines.append(f"{prefix} {a.message}")
    Path(path).write_text("\n".join(lines), encoding="utf-8")
