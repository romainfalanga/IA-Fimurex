"""Module 1 - Ingestion et classification des pages.

Decoupe le PDF en pages, produit pour chaque page une image + du texte, puis
classifie la page dans l'une des categories suivantes :
PAGE_GARDE | PLAN_COFFRAGE | HYPOTHESES | DETAIL | FICHE_FABRICATION | ANNEXE.

Voir section 2.2 / MODULE 1 de la specification.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional


# Categories possibles d'une page.
PAGE_CATEGORIES = (
    "PAGE_GARDE",
    "PLAN_COFFRAGE",
    "HYPOTHESES",
    "DETAIL",
    "FICHE_FABRICATION",
    "ANNEXE",
)


@dataclass
class IngestedPage:
    """Page du PDF apres conversion et classification."""

    index: int            # 0-based
    text: str             # texte extrait (OCR ou direct)
    image_path: str       # chemin vers l'image PNG de la page
    category: str         # element de PAGE_CATEGORIES
    niveau: Optional[str] = None  # Fondations / Haut VS / Haut RDC / Haut R+1
    repere: Optional[str] = None  # pour FICHE_FABRICATION : Ptre 01, Pot.2...
    metadata: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Classification textuelle (regles heuristiques, section 2.2 MODULE 1)
# ---------------------------------------------------------------------------

_NIVEAU_PATTERNS = [
    (re.compile(r"\bfondations?\b", re.IGNORECASE), "Fondations"),
    (re.compile(r"\bhaut\s*(?:du\s*)?(?:vide\s*sanitaire|vs|v\.s\.)\b", re.IGNORECASE), "Haut VS"),
    (re.compile(r"\bhaut\s*(?:du\s*)?(?:rdc|r\.d\.c\.|rez-de-chaussee|rez de chaussee)\b", re.IGNORECASE), "Haut RDC"),
    (re.compile(r"\bhaut\s*(?:du\s*)?r\+?1\b", re.IGNORECASE), "Haut R+1"),
    (re.compile(r"\bhaut\s*(?:du\s*)?r\+?2\b", re.IGNORECASE), "Haut R+2"),
]

_REPERE_FICHE_PATTERN = re.compile(
    r"\b(Ptre\s*\d+|Pot\.?\s*\d+|Chev\.?\s*\d+)\b",
    re.IGNORECASE,
)


def classify_page(text: str) -> str:
    """Classifie une page a partir de son texte, suivant la section 2.2 MODULE 1."""
    if not text:
        # Pas de texte exploitable : on verra a l'analyse visuelle (souvent un plan).
        return "PLAN_COFFRAGE"

    lower = text.lower()

    # PAGE_GARDE : presence simultanee de marqueurs du cartouche du dossier.
    garde_markers = ("dossier", "etabli par", "controle par", "constructeur", "be sol")
    if sum(1 for m in garde_markers if m in lower) >= 3:
        return "PAGE_GARDE"

    # HYPOTHESES
    if "hypotheses" in lower and (
        "zone sismique" in lower or "beton" in lower or "acier" in lower
    ):
        return "HYPOTHESES"

    # FICHE_FABRICATION : tableau Pos./Armature/Code/Forme + "Acier HA 500 ="
    if re.search(r"acier\s+ha\s*500\s*=", lower) or (
        "pos." in lower and "armature" in lower and "forme" in lower
    ):
        return "FICHE_FABRICATION"

    # DETAIL
    if re.search(r"\bdetails?\b", lower) and any(
        kw in lower for kw in (
            "fondations", "cv", "poteaux", "linteaux", "chainages",
            "porte-a-faux", "jonctions", "angles",
        )
    ):
        return "DETAIL"

    # PLAN_COFFRAGE
    if re.search(r"coffrage|fondations|haut\s+(vs|rdc|r\+1)", lower):
        return "PLAN_COFFRAGE"

    # ANNEXE : pages de transition
    if "annexe" in lower or "implantation" in lower:
        return "ANNEXE"

    return "PLAN_COFFRAGE"  # defaut prudent


def detect_niveau(text: str) -> Optional[str]:
    for pattern, niveau in _NIVEAU_PATTERNS:
        if pattern.search(text):
            return niveau
    return None


def detect_repere_fiche(text: str) -> Optional[str]:
    m = _REPERE_FICHE_PATTERN.search(text)
    if m:
        return m.group(1).replace(" ", "")
    return None


# ---------------------------------------------------------------------------
# Conversion PDF -> pages ingerees
# ---------------------------------------------------------------------------

def ingest_pdf(
    pdf_path: str,
    work_dir: str,
    *,
    dpi: int = 200,
) -> List[IngestedPage]:
    """Convertit un PDF en liste de pages classifiees.

    Dependances : pypdf pour le texte, pdf2image pour les images.
    """
    from pypdf import PdfReader
    from pdf2image import convert_from_path  # type: ignore

    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)
    images_dir = work / "pages"
    images_dir.mkdir(parents=True, exist_ok=True)

    reader = PdfReader(pdf_path)
    images = convert_from_path(pdf_path, dpi=dpi)

    pages: List[IngestedPage] = []
    for i, (pdf_page, image) in enumerate(zip(reader.pages, images)):
        text = pdf_page.extract_text() or ""
        image_path = images_dir / f"page_{i + 1:03d}.png"
        image.save(image_path, "PNG")

        category = classify_page(text)
        niveau = detect_niveau(text)
        repere = detect_repere_fiche(text) if category == "FICHE_FABRICATION" else None

        pages.append(
            IngestedPage(
                index=i,
                text=text,
                image_path=str(image_path),
                category=category,
                niveau=niveau,
                repere=repere,
            )
        )
    return pages
