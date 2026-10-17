import type { ContentTranslationGroup } from '../../core/api/models';

/**
 * The part of the website a WEBSITE text group belongs to, in site order.
 * The area is the key's FIRST segment only: `quote.product.*` belongs to
 * Offerte, not to a second "Producten". CATALOG keys all start with
 * `catalog.` and keep the workspace's own grouping (never use this there).
 * Pure and import-free (node-tested).
 */

export interface WebsiteTextArea {
  key: string;
  label: string;
  order: number;
}

const AREAS: readonly (WebsiteTextArea & { segments: readonly string[] })[] = [
  { key: 'home', label: 'Homepage', order: 1, segments: ['home', 'homepage'] },
  { key: 'header', label: 'Header & menu', order: 2, segments: ['header', 'navigation'] },
  { key: 'product', label: 'Productpagina’s', order: 3, segments: ['product', 'products'] },
  { key: 'categories', label: 'Categorieën', order: 4, segments: ['categories', 'category'] },
  { key: 'quote', label: 'Offerte', order: 5, segments: ['quote', 'ordering'] },
  { key: 'contact', label: 'Contact', order: 6, segments: ['contact'] },
  { key: 'about', label: 'Over ons', order: 7, segments: ['about'] },
  { key: 'customisation', label: 'Maatwerk', order: 8, segments: ['customisation'] },
  { key: 'footer', label: 'Footer', order: 9, segments: ['footer'] },
  { key: 'legal', label: 'Juridisch', order: 10, segments: ['legal'] },
  { key: 'meta', label: 'SEO', order: 11, segments: ['meta'] },
  { key: 'common', label: 'Algemeen', order: 12, segments: ['common'] },
  { key: 'consent', label: 'Cookies', order: 13, segments: ['consent'] },
  { key: 'language', label: 'Taalkeuze', order: 14, segments: ['language'] },
  { key: 'notFound', label: '404-pagina', order: 15, segments: ['notfound'] },
  { key: 'a11y', label: 'Toegankelijkheid', order: 16, segments: ['a11y'] },
];

export const OTHER_AREA: WebsiteTextArea = { key: 'other', label: 'Overig', order: 99 };

/** Homepage sub-areas by the key's second segment, in block order (website-builder-page.ts SECTION_DEFINITIONS). */
const HOME_SUB_AREAS: readonly { label: string; segments: readonly string[] }[] = [
  { label: 'Openingsbeeld', segments: ['hero', 'marquee'] },
  { label: 'Ons assortiment · Volledige collectie', segments: ['catalog'] },
  { label: 'Zo bestelt u', segments: ['order'] },
  { label: 'Handelsflow', segments: ['tradeflow'] },
  { label: 'Counterdisplays', segments: ['counter'] },
  { label: 'Glass bowls & flowerboxes', segments: ['flowerbox'] },
  { label: 'Zeep- en foamrozen', segments: ['soap'] },
  { label: 'Kleine cadeaus', segments: ['occasion'] },
  { label: 'Geschikt voor retail', segments: ['retail'] },
  { label: 'Veelgestelde vragen', segments: ['faq'] },
  { label: 'Offerte aanvragen', segments: ['quote'] },
];

function segments(key: string): string[] {
  return key.split('.').map((part) => part.trim()).filter(Boolean);
}

export function websiteTextArea(key: string): WebsiteTextArea {
  const first = (segments(key)[0] ?? '').toLowerCase();
  const area = AREAS.find((candidate) => candidate.segments.includes(first));
  return area ? { key: area.key, label: area.label, order: area.order } : OTHER_AREA;
}

/** Every area in site order (without Overig), e.g. for an empty list of parts. */
export function websiteTextAreas(): WebsiteTextArea[] {
  return AREAS.map(({ key, label, order }) => ({ key, label, order }));
}

/** The Homepage sub-area of a key ("Openingsbeeld"), its position, or null outside the homepage. */
export function homeSubArea(key: string): { label: string; order: number } | null {
  if (websiteTextArea(key).key !== 'home') return null;
  const second = (segments(key)[1] ?? '').toLowerCase();
  const index = HOME_SUB_AREAS.findIndex((sub) => sub.segments.includes(second));
  return index < 0 ? { label: 'Overig', order: 99 } : { label: HOME_SUB_AREAS[index].label, order: index + 1 };
}

/**
 * The label without the repeated area word: "Homepage · Hero · titel" reads
 * "Hero · titel" under Homepage. A label that is only its key
 * ("consent.enabled") shows the Dutch text instead, cut to 48 characters;
 * the key stays in the row's title attribute.
 */
export function displayLabel(group: Pick<ContentTranslationGroup, 'key' | 'label' | 'texts'>, area: WebsiteTextArea = websiteTextArea(group.key)): string {
  const label = group.label?.trim() ?? '';
  if (!label || label === group.key) {
    const dutch = group.texts?.find((text) => text.language === 'NL')?.value?.replace(/\s+/g, ' ').trim() ?? '';
    if (!dutch) return group.key;
    return dutch.length > 48 ? `${dutch.slice(0, 47).trimEnd()}…` : dutch;
  }
  const parts = label.split(' · ');
  if (parts.length > 1 && parts[0].trim().toLocaleLowerCase('nl') === area.label.toLocaleLowerCase('nl')) {
    const rest = parts.slice(1).join(' · ');
    return rest.charAt(0).toLocaleUpperCase('nl') + rest.slice(1);
  }
  return label;
}

export interface WebsiteTextSection<T> {
  area: WebsiteTextArea;
  groups: T[];
}

/**
 * Groups in areas in site order. Inside an area the server order stays
 * (the seed's order), except on the Homepage, which follows its blocks.
 */
export function groupByArea<T extends Pick<ContentTranslationGroup, 'key'>>(groups: readonly T[]): WebsiteTextSection<T>[] {
  const sections = new Map<string, WebsiteTextSection<T>>();
  for (const group of groups) {
    const area = websiteTextArea(group.key);
    const section = sections.get(area.key) ?? { area, groups: [] };
    section.groups.push(group);
    sections.set(area.key, section);
  }
  const result = [...sections.values()].sort((left, right) => left.area.order - right.area.order
    || left.area.label.localeCompare(right.area.label, 'nl'));
  for (const section of result) {
    if (section.area.key !== 'home') continue;
    const position = new Map(section.groups.map((group, index) => [group.key, index]));
    section.groups.sort((left, right) => (homeSubArea(left.key)?.order ?? 99) - (homeSubArea(right.key)?.order ?? 99)
      || position.get(left.key)! - position.get(right.key)!);
  }
  return result;
}
