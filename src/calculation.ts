// Moteur de calcul deterministe - port TypeScript du module Python.
// Reference : sections 4.3, 4.4 et 5.3 de la specification.

export const MASSES_LINEIQUES: Record<number, number> = {
  5: 0.154,
  6: 0.222,
  8: 0.395,
  10: 0.617,
  12: 0.888,
  14: 1.208,
  16: 1.578,
  20: 2.466,
  25: 3.853,
  32: 6.313,
};

export const POIDS_TREILLIS_SOUDES: Record<string, number> = {
  ST15C: 16.0,
  ST20C: 22.0,
  ST25C: 32.0,
  ST40C: 86.98,
};

export type TypeArmature = "STANDARD" | "COUPE FACONNE" | "FABRICATION";
export type Confiance = "HAUTE" | "MOYENNE" | "BASSE";

function masseLineique(d: number): number {
  const m = MASSES_LINEIQUES[d];
  if (m === undefined) throw new Error(`Diametre HA${d} inconnu`);
  return m;
}

export function poidsBarreSimple(diametreMm: number, longueurM: number): number {
  return longueurM * masseLineique(diametreMm);
}

export function poidsEquerre(diametreMm: number, dim1Cm: number, dim2Cm: number): number {
  return ((dim1Cm + dim2Cm) / 100) * masseLineique(diametreMm);
}

export function poidsU(
  diametreMm: number,
  dim1Cm: number,
  fondCm: number,
  dim2Cm: number,
): number {
  return ((dim1Cm + fondCm + dim2Cm) / 100) * masseLineique(diametreMm);
}

export function poidsCrosse(diametreMm: number, dim1Cm: number, retourCm: number): number {
  return ((dim1Cm + retourCm) / 100) * masseLineique(diametreMm);
}

export function poidsTreillisSoude(reference: string): number {
  const p = POIDS_TREILLIS_SOUDES[reference];
  if (p === undefined) throw new Error(`Treillis ${reference} inconnu`);
  return p;
}

export interface CageStandardParams {
  nbBarres: number;
  diametreBarreMm: number;
  typeCadre: "Cad" | "Ep";
  diametreCadreMm: number;
  dim1CadreCm: number;
  dim2CadreCm: number;
  espacementCm: number;
  longueurM: number;
}

export function poidsCageStandard(p: CageStandardParams): number {
  const masseBarre = masseLineique(p.diametreBarreMm);
  const masseCadre = masseLineique(p.diametreCadreMm);
  const poidsBarres = p.nbBarres * p.longueurM * masseBarre;
  const longueurCrochetsM = (2 * 10 * p.diametreCadreMm) / 1000;
  const longueurCadreM =
    p.typeCadre === "Cad"
      ? (2 * (p.dim1CadreCm + p.dim2CadreCm)) / 100 + longueurCrochetsM
      : (2 * p.dim1CadreCm + p.dim2CadreCm) / 100 + longueurCrochetsM;
  const nbCadres = Math.floor((p.longueurM * 100) / p.espacementCm) + 1;
  const poidsCadres = nbCadres * longueurCadreM * masseCadre;
  return poidsBarres + poidsCadres;
}

export function poidsAttentesBlocsABancher(): number {
  // Ligne "Attentes blocs a bancher" de l'exemple de reference (19.16 kg/u).
  const longueurM = 4.0;
  const filants = 2 * longueurM * masseLineique(8);
  const longueurU = (70 + 10 + 70) / 100;
  const nbU = Math.floor((longueurM * 100) / 15) + 1;
  const poidsU = nbU * longueurU * masseLineique(8);
  return filants + poidsU;
}

// --- Structures du Carnet BA ------------------------------------------

export interface LigneCarnet {
  designation: string;
  nomenclature: string;
  type_armature: TypeArmature;
  poids_unitaire_kg: number;
  quantite: number;
  poids_total_kg: number;
  detail_calcul?: string;
  confiance?: Confiance;
}

export interface SectionCarnet {
  section: string;
  lignes: LigneCarnet[];
  poids_section_kg: number;
}

export interface CarnetBA {
  entete: {
    dossier: string;
    chantier: string;
    commune: string;
    zone_sismique: string;
  };
  sections: SectionCarnet[];
  total_general_kg: number;
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function finalizeCarnet(raw: {
  entete: CarnetBA["entete"];
  sections: Array<{ section: string; lignes: Omit<LigneCarnet, "poids_total_kg">[] }>;
}): CarnetBA {
  const sections: SectionCarnet[] = raw.sections.map((s) => {
    const lignes = s.lignes.map((l) => ({
      ...l,
      poids_unitaire_kg: round2(l.poids_unitaire_kg),
      poids_total_kg: round2(l.poids_unitaire_kg * l.quantite),
    }));
    const poidsSection = round2(lignes.reduce((acc, l) => acc + l.poids_total_kg, 0));
    return { section: s.section, lignes, poids_section_kg: poidsSection };
  });
  const total = round2(sections.reduce((acc, s) => acc + s.poids_section_kg, 0));
  return { entete: raw.entete, sections, total_general_kg: total };
}
