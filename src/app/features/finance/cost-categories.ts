/** What the company spends on, for the pickers and the analyses. A code not in this list still shows under its own name. */
export interface CostCategory {
  code: string;
  label: string;
  hint: string;
  /** A workspace kit tone (tone-*) for the phone tile and the desk dot. */
  tone?: CategoryTone;
}

export type CategoryTone = 'accent' | 'blue' | 'teal' | 'amber' | 'green' | 'plum' | 'grey' | 'ink';

export const COST_CATEGORIES: readonly CostCategory[] = [
  { code: 'BEURS', label: 'Beurs & stand', hint: 'Standhuur, opbouw, inschrijving', tone: 'accent' },
  { code: 'TICA', label: 'TICA', hint: 'Standhuur en kosten bij TICA', tone: 'accent' },
  { code: 'HUUR', label: 'Huur & magazijn', hint: 'Magazijn, kantoor, opslag', tone: 'blue' },
  { code: 'BOEKHOUDER', label: 'Boekhouder & advies', hint: 'Accountant, jurist, adviseur', tone: 'ink' },
  { code: 'TRANSPORT', label: 'Transport & verzending', hint: 'Koerier, pallets, brandstof', tone: 'amber' },
  { code: 'MARKETING', label: 'Marketing & website', hint: 'Advertenties, drukwerk, domein', tone: 'plum' },
  { code: 'SOFTWARE', label: 'Software & abonnementen', hint: 'Hosting, licenties, telefonie', tone: 'teal' },
  { code: 'VERZEKERING', label: 'Verzekering & bank', hint: 'Premies, bankkosten, intrest', tone: 'grey' },
  { code: 'REIS', label: 'Reis & verblijf', hint: 'Bezoeken aan leveranciers en beurzen', tone: 'amber' },
  { code: 'MATERIAAL', label: 'Materiaal & verpakking', hint: 'Dozen, folie, stellingen', tone: 'green' },
  { code: 'LOON', label: 'Personeel & loon', hint: 'Lonen, sociale bijdragen, interim', tone: 'plum' },
  { code: 'ANDERE', label: 'Andere', hint: 'Wat nergens anders past', tone: 'grey' },
];

export function categoryLabel(code: string | null | undefined): string {
  const normalised = (code ?? '').trim().toUpperCase();
  if (!normalised) return 'Zonder categorie';
  return COST_CATEGORIES.find((category) => category.code === normalised)?.label
    ?? normalised.charAt(0) + normalised.slice(1).toLowerCase().replace(/_/g, ' ');
}

/** The tone of a category; codes of their own are grey. */
export function categoryTone(code: string | null | undefined): CategoryTone {
  const normalised = (code ?? '').trim().toUpperCase();
  return COST_CATEGORIES.find((category) => category.code === normalised)?.tone ?? 'grey';
}

/** The known categories plus every code in use, so a picker never hides a stored value. */
export function categoryChoices(inUse: readonly (string | null | undefined)[]): CostCategory[] {
  const known = [...COST_CATEGORIES];
  for (const raw of inUse) {
    const code = (raw ?? '').trim().toUpperCase();
    if (code && !known.some((category) => category.code === code)) known.push({ code, label: categoryLabel(code), hint: 'Eigen categorie', tone: 'grey' });
  }
  return known;
}
