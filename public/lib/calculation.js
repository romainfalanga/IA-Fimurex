// Moteur de calcul deterministe - port JS du module Python.
// Reference : sections 4.3, 4.4 et 5.3 de la specification.

export const MASSES_LINEIQUES = {
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

export const POIDS_TREILLIS_SOUDES = {
  ST15C: 16.0,
  ST20C: 22.0,
  ST25C: 32.0,
  ST40C: 86.98,
};

function masseLineique(d) {
  const m = MASSES_LINEIQUES[d];
  if (m === undefined) throw new Error(`Diametre HA${d} inconnu`);
  return m;
}

export function poidsBarreSimple(diametreMm, longueurM) {
  return longueurM * masseLineique(diametreMm);
}

export function poidsEquerre(diametreMm, dim1Cm, dim2Cm) {
  return ((dim1Cm + dim2Cm) / 100) * masseLineique(diametreMm);
}

export function poidsU(diametreMm, dim1Cm, fondCm, dim2Cm) {
  return ((dim1Cm + fondCm + dim2Cm) / 100) * masseLineique(diametreMm);
}

export function poidsCrosse(diametreMm, dim1Cm, retourCm) {
  return ((dim1Cm + retourCm) / 100) * masseLineique(diametreMm);
}

export function poidsTreillisSoude(reference) {
  const p = POIDS_TREILLIS_SOUDES[reference];
  if (p === undefined) throw new Error(`Treillis ${reference} inconnu`);
  return p;
}

export function poidsCageStandard(p) {
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

export function poidsAttentesBlocsABancher() {
  const longueurM = 4.0;
  const filants = 2 * longueurM * masseLineique(8);
  const longueurU = (70 + 10 + 70) / 100;
  const nbU = Math.floor((longueurM * 100) / 15) + 1;
  const poidsU = nbU * longueurU * masseLineique(8);
  return filants + poidsU;
}

// ---- Recouvrement et metré ----
// Les barres standard font 6m mais se chevauchent (recouvrement).
// Longueur utile = 6m - recouvrement.

export const LONGUEUR_BARRE_STD = 6.0;

export const RECOUVREMENT = {
  SF50: 0.50,
  SF50e: 0.50,
  CH: 0.50,
  CP: 0.50,
};

export function longueurUtile(repere) {
  const rec = RECOUVREMENT[repere] ?? 0;
  return LONGUEUR_BARRE_STD - rec;
}

export function nbUnitesFromMetre(repere, longueurTotaleM) {
  if (longueurTotaleM <= 0) return 0;
  const utile = longueurUtile(repere);
  return Math.ceil(longueurTotaleM / utile);
}

export function round2(x) {
  return Math.round(x * 100) / 100;
}

export function finalizeCarnet(raw) {
  const sections = (raw.sections || []).map((s) => {
    const lignes = (s.lignes || []).map((l) => {
      const poidsUnit = round2(Number(l.poids_unitaire_kg) || 0);
      const qte = Number(l.quantite) || 0;
      return {
        ...l,
        poids_unitaire_kg: poidsUnit,
        quantite: qte,
        poids_total_kg: round2(poidsUnit * qte),
      };
    });
    const poidsSection = round2(
      lignes.reduce((acc, l) => acc + l.poids_total_kg, 0),
    );
    return { section: s.section, lignes, poids_section_kg: poidsSection };
  });
  const total = round2(sections.reduce((a, s) => a + s.poids_section_kg, 0));
  return { entete: raw.entete, sections, total_general_kg: total };
}
