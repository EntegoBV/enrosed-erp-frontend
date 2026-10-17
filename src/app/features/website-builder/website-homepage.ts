import type {
  WebsiteBuilderHomepage,
  WebsiteBuilderSection,
  WebsiteBuilderSectionKey,
} from '../../core/api/models';

/**
 * The homepage layout as figures, for the side, the Overzicht and
 * Publicatie: how many blocks show in the concept and live, whether they
 * differ and how. The block order and the fixed first and last block follow
 * SECTION_DEFINITIONS of website-builder-page.ts. Pure and import-free
 * (node-tested).
 */

export const HOMEPAGE_SECTION_KEYS: readonly WebsiteBuilderSectionKey[] = [
  'hero', 'range', 'order', 'counter', 'flowerbox', 'soap', 'occasion', 'retail', 'faq', 'catalog', 'quote',
];
const KNOWN = new Set<WebsiteBuilderSectionKey>(HOMEPAGE_SECTION_KEYS);
export const FIXED_SECTION_KEYS: ReadonlySet<WebsiteBuilderSectionKey> = new Set<WebsiteBuilderSectionKey>(['hero', 'quote']);

/** Known blocks once each, the fixed blocks first and last and always visible, missing blocks appended visible. */
export function normalizeSections(input: readonly WebsiteBuilderSection[] | null | undefined): WebsiteBuilderSection[] {
  const enabled = new Map<WebsiteBuilderSectionKey, boolean>();
  for (const section of input ?? []) {
    if (KNOWN.has(section.key) && !enabled.has(section.key)) enabled.set(section.key, !!section.enabled);
  }
  const middle: WebsiteBuilderSection[] = [];
  for (const section of input ?? []) {
    if (FIXED_SECTION_KEYS.has(section.key) || !KNOWN.has(section.key) || middle.some((item) => item.key === section.key)) continue;
    middle.push({ key: section.key, enabled: enabled.get(section.key) ?? true });
  }
  for (const key of HOMEPAGE_SECTION_KEYS) {
    if (FIXED_SECTION_KEYS.has(key) || middle.some((section) => section.key === key)) continue;
    middle.push({ key, enabled: enabled.get(key) ?? true });
  }
  return [{ key: 'hero', enabled: true }, ...middle, { key: 'quote', enabled: true }];
}

export interface HomepageSummary {
  total: number;
  draftVisible: number;
  publishedVisible: number;
  /** The concept differs from what is live. */
  differs: boolean;
  /** Never published: the website shows its standard layout. */
  neverPublished: boolean;
  updatedAt: string | null;
  publishedAt: string | null;
  /** The concept counter ("Conceptversie"), not a live revision. */
  revision: string | number;
}

export function homepageSummary(snapshot: WebsiteBuilderHomepage): HomepageSummary {
  const draft = normalizeSections(snapshot.draft?.sections);
  const published = normalizeSections(snapshot.published?.sections);
  return {
    total: draft.length,
    draftVisible: draft.filter((section) => section.enabled).length,
    publishedVisible: published.filter((section) => section.enabled).length,
    differs: JSON.stringify(draft) !== JSON.stringify(published),
    neverPublished: !snapshot.publishedAt,
    updatedAt: snapshot.updatedAt,
    publishedAt: snapshot.publishedAt,
    revision: snapshot.revision,
  };
}

export interface HomepageDifference {
  key: WebsiteBuilderSectionKey;
  /** 1-based positions; normalizeSections puts every block on both sides. */
  draftPosition: number;
  livePosition: number;
  draftVisible: boolean;
  liveVisible: boolean;
}

/** Blocks whose visibility or position differs between the concept and live, in concept order. */
export function homepageDifferences(snapshot: WebsiteBuilderHomepage): HomepageDifference[] {
  const draft = normalizeSections(snapshot.draft?.sections);
  const published = normalizeSections(snapshot.published?.sections);
  return draft.flatMap((section, index) => {
    const liveIndex = published.findIndex((item) => item.key === section.key);
    const live = published[liveIndex];
    if (live && live.enabled === section.enabled && liveIndex === index) return [];
    return [{ key: section.key, draftPosition: index + 1, livePosition: liveIndex + 1,
      draftVisible: section.enabled, liveVisible: !!live?.enabled }];
  });
}

/** The block names as the builder shows them (SECTION_DEFINITIONS of website-builder-page.ts). */
export const HOMEPAGE_SECTION_LABELS: Readonly<Record<WebsiteBuilderSectionKey, string>> = {
  hero: 'Openingsbeeld & tekstband', range: 'Ons assortiment', order: 'Zo bestelt u', counter: 'Counterdisplays',
  flowerbox: 'Glass bowls & flowerboxes', soap: 'Zeep- en foamrozen', occasion: 'Kleine cadeaus', retail: 'Geschikt voor retail',
  faq: 'Veelgestelde vragen', catalog: 'Volledige collectie', quote: 'Offerte aanvragen',
};

/** "Kleine cadeaus · verborgen in concept, zichtbaar live", "Glass bowls & flowerboxes · positie 3 in concept, 5 live". */
export function differenceLine(difference: HomepageDifference): string {
  const parts: string[] = [];
  if (difference.draftVisible !== difference.liveVisible) {
    parts.push(difference.draftVisible ? 'zichtbaar in concept, verborgen live' : 'verborgen in concept, zichtbaar live');
  }
  if (difference.draftPosition !== difference.livePosition) {
    parts.push(`positie ${difference.draftPosition} in concept, ${difference.livePosition} live`);
  }
  return `${HOMEPAGE_SECTION_LABELS[difference.key]} · ${parts.join(' · ')}`;
}
