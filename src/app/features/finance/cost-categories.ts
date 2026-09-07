/** What the company spends on, for the pickers and the analyses. A code not in this list still shows under its own name. */
export interface CostCategory {
  code: string;
  label: string;
  hint: string;
}

export const COST_CATEGORIES: readonly CostCategory[] = [
  { code: 'BEURS', label: 'Beurs & stand', hint: 'Standhuur, opbouw, inschrijving' },
  { code: 'TICA', label: 'TICA', hint: 'Standhuur en kosten bij TICA' },
  { code: 'HUUR', label: 'Huur & magazijn', hint: 'Magazijn, kantoor, opslag' },
  { code: 'BOEKHOUDER', label: 'Boekhouder & advies', hint: 'Accountant, jurist, adviseur' },
  { code: 'TRANSPORT', label: 'Transport & verzending', hint: 'Koerier, pallets, brandstof' },
  { code: 'MARKETING', label: 'Marketing & website', hint: 'Advertenties, drukwerk, domein' },
  { code: 'SOFTWARE', label: 'Software & abonnementen', hint: 'Hosting, licenties, telefonie' },
  { code: 'VERZEKERING', label: 'Verzekering & bank', hint: 'Premies, bankkosten, intrest' },
  { code: 'REIS', label: 'Reis & verblijf', hint: 'Bezoeken aan leveranciers en beurzen' },
  { code: 'MATERIAAL', label: 'Materiaal & verpakking', hint: 'Dozen, folie, stellingen' },
  { code: 'LOON', label: 'Personeel & loon', hint: 'Lonen, sociale bijdragen, interim' },
  { code: 'ANDERE', label: 'Andere', hint: 'Wat nergens anders past' },
];

export function categoryLabel(code: string | null | undefined): string {
  const normalised = (code ?? '').trim().toUpperCase();
  if (!normalised) return 'Zonder categorie';
  return COST_CATEGORIES.find((category) => category.code === normalised)?.label
    ?? normalised.charAt(0) + normalised.slice(1).toLowerCase().replace(/_/g, ' ');
}

/** The known categories plus every code in use, so a picker never hides a stored value. */
export function categoryChoices(inUse: readonly (string | null | undefined)[]): CostCategory[] {
  const known = [...COST_CATEGORIES];
  for (const raw of inUse) {
    const code = (raw ?? '').trim().toUpperCase();
    if (code && !known.some((category) => category.code === code)) known.push({ code, label: categoryLabel(code), hint: 'Eigen categorie' });
  }
  return known;
}
