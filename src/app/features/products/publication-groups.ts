/*
 * The open publication points of a series, grouped by where they are
 * fixed: the website text, the photos, the collection, the settings. The
 * phone product page lists them read-only; the desk links each group.
 * Pure and import-free: node-tested.
 */

export interface PublicationGroup {
  key: 'copy' | 'photos' | 'collection' | 'settings';
  label: string;
  issues: string[];
}

const LABELS: Readonly<Record<PublicationGroup['key'], string>> = {
  copy: 'Websitetekst',
  photos: 'Foto’s',
  collection: 'Collectie op de website',
  settings: 'Publicatie-instellingen',
};

export function publicationGroupKey(issue: string): PublicationGroup['key'] {
  if (/foto/i.test(issue)) return 'photos';
  if (/collectie/i.test(issue)) return 'collection';
  if (/samenvatting|beschrijving|seo|vertaald|highlights|formaat|alt-tekst|kleurnaam|\bnaam\b|\bmaat\b/i.test(issue)) return 'copy';
  return 'settings';
}

/** The groups that have points, in a fixed order (text, photos, collection, settings). */
export function groupPublicationIssues(issues: readonly string[]): PublicationGroup[] {
  const groups: PublicationGroup[] = (['copy', 'photos', 'collection', 'settings'] as const).map((key) => ({ key, label: LABELS[key], issues: [] }));
  for (const issue of issues) groups.find((group) => group.key === publicationGroupKey(issue))!.issues.push(issue);
  return groups.filter((group) => group.issues.length);
}
