import type { PublicationStatus } from '../../core/api/models';

/**
 * How Producten (/website/products) filters, groups and describes its rows.
 * Rows come in prepared (attention reason, figures); this module only
 * decides lists and words. Pure and import-free (node-tested).
 */

export type ProductFilter = 'aandacht' | 'alles' | 'live' | 'concept' | 'verborgen';
export const PRODUCT_FILTERS: readonly ProductFilter[] = ['aandacht', 'alles', 'live', 'concept', 'verborgen'];
export const PRODUCT_FILTER_LABELS: Record<ProductFilter, string> = {
  aandacht: 'Aandacht', alles: 'Alles', live: 'Live', concept: 'Concept', verborgen: 'Verborgen',
};

type Reason = 'inactive-live' | 'issues' | 'ready' | 'incomplete';
const REASON_ORDER: readonly Reason[] = ['inactive-live', 'issues', 'ready', 'incomplete'];
const REASON_HEADINGS: Record<Reason, string> = {
  'inactive-live': 'Live, maar niet actief in ERP',
  issues: 'Nog niet publicatieklaar',
  ready: 'Klaar om live te zetten',
  incomplete: 'Live, teksten onvolledig',
};

export interface ProductViewRow {
  id: number | null;
  key: string;
  name: string;
  status: PublicationStatus;
  active: boolean;
  reason: Reason | null;
  points: number;
  bestseller: boolean;
  categoryId: number | null;
  categoryName: string | null;
  categoryPosition: number;
  productPosition: number;
  /** Lower-cased, accent-free text to search in: name, family key, webadres, category. */
  search: string;
}

export interface ProductViewGroup<T extends ProductViewRow> {
  key: string;
  label: string;
  rows: T[];
}

export function parseProductFilter(value: string | null | undefined): ProductFilter | null {
  const filter = (value ?? '').trim().toLowerCase();
  return (PRODUCT_FILTERS as readonly string[]).includes(filter) ? filter as ProductFilter : null;
}

/** Without a filter in the address: Aandacht when something needs it, else Alles. */
export function defaultProductFilter(attention: number): ProductFilter {
  return attention > 0 ? 'aandacht' : 'alles';
}

export function searchText(...parts: readonly (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function matchesFilter(row: ProductViewRow, filter: ProductFilter, kept: ReadonlyMap<string, Reason>): boolean {
  switch (filter) {
    case 'aandacht': return row.reason !== null || kept.has(row.key);
    case 'live': return row.status === 'PUBLISHED';
    case 'concept': return row.status === 'DRAFT';
    case 'verborgen': return row.status === 'READY';
    default: return true;
  }
}

/** Counts on the chips (search does not change them). */
export function filterCounts(rows: readonly ProductViewRow[], kept: ReadonlyMap<string, Reason>): Record<ProductFilter, number> {
  return Object.fromEntries(PRODUCT_FILTERS.map((filter) => [filter, rows.filter((row) => matchesFilter(row, filter, kept)).length])) as Record<ProductFilter, number>;
}

function byPlace(left: ProductViewRow, right: ProductViewRow): number {
  return Number(right.bestseller) - Number(left.bestseller)
    || left.productPosition - right.productPosition
    || left.name.localeCompare(right.name, 'nl');
}

/**
 * Aandacht groups per reason (most points first, then the catalogue
 * order); every other filter groups per category in category order with
 * the bestsellers first. "kept" holds the reasons from the last load, so a
 * reeks that was just fixed stays in its group until the next load.
 */
export function productGroups<T extends ProductViewRow>(
  rows: readonly T[],
  filter: ProductFilter,
  query: string,
  kept: ReadonlyMap<string, Reason> = new Map(),
): ProductViewGroup<T>[] {
  const needle = searchText(query);
  const visible = rows.filter((row) => matchesFilter(row, filter, kept) && (!needle || row.search.includes(needle)));
  if (filter === 'aandacht') {
    return REASON_ORDER.map((reason) => ({
      key: reason,
      label: REASON_HEADINGS[reason],
      rows: visible.filter((row) => (kept.get(row.key) ?? row.reason) === reason)
        .sort((left, right) => right.points - left.points || left.categoryPosition - right.categoryPosition || byPlace(left, right)),
    })).filter((group) => group.rows.length > 0);
  }
  const groups = new Map<string, ProductViewGroup<T> & { position: number }>();
  for (const row of visible) {
    const key = row.categoryId === null && !row.categoryName ? 'none' : String(row.categoryId ?? row.categoryName);
    const group = groups.get(key) ?? { key, label: row.categoryName || 'Zonder categorie', rows: [], position: key === 'none' ? Number.MAX_SAFE_INTEGER : row.categoryPosition };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((left, right) => left.position - right.position || left.label.localeCompare(right.label, 'nl'))
    .map(({ key, label, rows: list }) => ({ key, label, rows: list.sort(byPlace) }));
}

/** The short reason under a name: "Concept · 8 publicatiepunten", "Concept · klaar om live te zetten", "Live · compleet". */
export function productStatusLine(row: Pick<ProductViewRow, 'status' | 'active' | 'reason' | 'points'>, statusWord: string): string {
  switch (row.reason) {
    case 'inactive-live': return 'Live · niet actief in ERP';
    case 'issues': return `${statusWord} · ${row.points} ${row.points === 1 ? 'publicatiepunt' : 'publicatiepunten'}`;
    case 'ready': return `${statusWord} · klaar om live te zetten`;
    case 'incomplete': return 'Live · teksten onvolledig';
    default: return row.status === 'PUBLISHED' ? 'Live · compleet' : statusWord;
  }
}
