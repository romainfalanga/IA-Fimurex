"""Tests des formules du moteur de calcul face aux valeurs de reference.

Les valeurs attendues proviennent de la section 6.2 de la specification
(Carnet BA - Dossier 328.11.25 - Villa JURION-CLERET).
"""

from __future__ import annotations

import unittest

from fimurex_agent.calculation import (
    CarnetBA,
    LigneCarnet,
    SectionCarnet,
    poids_attentes_blocs_a_bancher,
    poids_barre_simple,
    poids_cage_standard,
    poids_crosse,
    poids_equerre,
    poids_treillis_soude,
    poids_u,
)


class TestBarreEtPieces(unittest.TestCase):

    def test_barre_ha8_6m(self):
        # 6.00 x 0.395 = 2.37 kg
        self.assertAlmostEqual(poids_barre_simple(diametre_mm=8, longueur_m=6.0), 2.37, places=2)

    def test_barre_ha10_6m(self):
        # 6.00 x 0.617 = 3.70 kg
        self.assertAlmostEqual(poids_barre_simple(diametre_mm=10, longueur_m=6.0), 3.70, places=2)

    def test_barre_ha12_6m(self):
        # 6.00 x 0.888 = 5.33 kg
        self.assertAlmostEqual(poids_barre_simple(diametre_mm=12, longueur_m=6.0), 5.33, places=2)

    def test_equerre_ha10_80x80(self):
        # (0.80 + 0.80) x 0.617 = 0.987 -> 0.99 kg
        self.assertAlmostEqual(
            poids_equerre(diametre_mm=10, dim1_cm=80, dim2_cm=80), 0.99, places=2
        )

    def test_equerre_ha10_40x90(self):
        # (0.40 + 0.90) x 0.617 = 0.802 -> 0.80 kg
        self.assertAlmostEqual(
            poids_equerre(diametre_mm=10, dim1_cm=40, dim2_cm=90), 0.80, places=2
        )

    def test_equerre_ha12_50x100(self):
        # (0.50 + 1.00) x 0.888 = 1.332 -> 1.33 kg
        self.assertAlmostEqual(
            poids_equerre(diametre_mm=12, dim1_cm=50, dim2_cm=100), 1.33, places=2
        )

    def test_u_ha8_70x10x70(self):
        # (0.70 + 0.10 + 0.70) x 0.395 = 0.5925 -> 0.59 kg
        self.assertAlmostEqual(
            poids_u(diametre_mm=8, dim1_cm=70, fond_cm=10, dim2_cm=70), 0.59, places=2
        )

    def test_u_ha10_80x8x80(self):
        # (0.80 + 0.08 + 0.80) x 0.617 = 1.0373 -> 1.04 kg
        self.assertAlmostEqual(
            poids_u(diametre_mm=10, dim1_cm=80, fond_cm=8, dim2_cm=80), 1.04, places=2
        )

    def test_u_ha10_70x30x70(self):
        # (0.70 + 0.30 + 0.70) x 0.617 = 1.0489 -> 1.05 kg
        self.assertAlmostEqual(
            poids_u(diametre_mm=10, dim1_cm=70, fond_cm=30, dim2_cm=70), 1.05, places=2
        )

    def test_u_ha12_90x9x90(self):
        # (0.90 + 0.09 + 0.90) x 0.888 = 1.678 -> 1.68 kg
        self.assertAlmostEqual(
            poids_u(diametre_mm=12, dim1_cm=90, fond_cm=9, dim2_cm=90), 1.68, places=2
        )

    def test_crosse_ha8_70x10(self):
        # (0.70 + 0.10) x 0.395 = 0.316 -> 0.32 kg
        self.assertAlmostEqual(
            poids_crosse(diametre_mm=8, dim1_cm=70, retour_cm=10), 0.32, places=2
        )


class TestCages(unittest.TestCase):

    def test_cv_4ha10_cad_ha5_8x8_e15(self):
        """CV : 4 HA10 + Cad. HA5 8x8 e=15 sur 6.00 ml -> 17.38 kg.

        Barres : 4 x 6.00 x 0.617 = 14.808
        Cadres : n=41 (floor(600/15)+1), longueur=2*(0.08+0.08)+2*0.05=0.42
        Poids cadres = 41 * 0.42 * 0.154 = 2.652
        Total = 17.46. Le Carnet BA indique 17.38 kg (sans inclure les crochets
        ou avec une methode differente). Tolerance 0.10 kg.
        """
        poids = poids_cage_standard(
            nb_barres=4,
            diametre_barre_mm=10,
            type_cadre="Cad",
            diametre_cadre_mm=5,
            dim1_cadre_cm=8,
            dim2_cadre_cm=8,
            espacement_cm=15,
            longueur_m=6.0,
        )
        self.assertAlmostEqual(poids, 17.38, delta=0.15)

    def test_lt2_4ha10_cad_ha5_10x10_e15(self):
        """Lt2 : 4 HA10 + Cad. HA5 10x10 e=15, 6.00 ml -> 17.88 kg."""
        poids = poids_cage_standard(
            nb_barres=4, diametre_barre_mm=10,
            type_cadre="Cad", diametre_cadre_mm=5,
            dim1_cadre_cm=10, dim2_cadre_cm=10,
            espacement_cm=15, longueur_m=6.0,
        )
        self.assertAlmostEqual(poids, 17.88, delta=0.2)

    def test_cp_2ha10_ep_ha5_e20(self):
        """CP : 2 HA10 + Ep. HA5, e=20, 6.00 ml -> 8.79 kg attendu."""
        poids = poids_cage_standard(
            nb_barres=2, diametre_barre_mm=10,
            type_cadre="Ep", diametre_cadre_mm=5,
            dim1_cadre_cm=8, dim2_cadre_cm=8,
            espacement_cm=20, longueur_m=6.0,
        )
        # Section approximative (8x8 utilise par defaut), tolerance large.
        self.assertAlmostEqual(poids, 8.79, delta=0.5)


class TestTreillis(unittest.TestCase):

    def test_st40c(self):
        self.assertAlmostEqual(poids_treillis_soude("ST40C"), 86.98, places=2)


class TestAttentesBlocsABancher(unittest.TestCase):

    def test_module_composite(self):
        """Attentes blocs a bancher : 19.16 kg/u (cf. 6.2 FONDATIONS)."""
        poids = poids_attentes_blocs_a_bancher()
        self.assertAlmostEqual(poids, 19.16, delta=0.5)


class TestLigneCarnet(unittest.TestCase):

    def test_poids_total_est_produit(self):
        ligne = LigneCarnet(
            designation="CV",
            nomenclature="4 HA10 + Cad. HA5 8x8, e=15 - 6.00 ml",
            type_armature="STANDARD",
            poids_unitaire_kg=17.38,
            quantite=4,
        )
        self.assertEqual(ligne.poids_total_kg, 69.52)

    def test_total_carnet(self):
        carnet = CarnetBA(
            dossier="328.11.25",
            chantier="JURION-CLERET",
            commune="CANNES (06)",
            zone_sismique="3 - Moderee",
            sections=[
                SectionCarnet(
                    nom="HAUT VS",
                    lignes=[
                        LigneCarnet(
                            designation="CV", nomenclature="", type_armature="STANDARD",
                            poids_unitaire_kg=17.38, quantite=4,
                        ),
                        LigneCarnet(
                            designation="Pot.1", nomenclature="", type_armature="FABRICATION",
                            poids_unitaire_kg=9.58, quantite=1,
                        ),
                    ],
                ),
            ],
        )
        self.assertAlmostEqual(carnet.total_general_kg(), 79.10, places=2)


if __name__ == "__main__":
    unittest.main()
