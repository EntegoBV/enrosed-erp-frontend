/*
 * The Producten list's state in the address bar: search, category,
 * publication status, order and the opened series. Read once when the list
 * opens and written back with Location.replaceState, so back from a product
 * shows the list as it was. Defaults are left out of the query string.
 * Pure and import-free: node-tested.
 */

export type ListSort = 'STOCK_SMART' | 'NAME_ASC' | 'NAME_DESC' | 'SKU' | 'STOCK_DESC' | 'STOCK_ASC'
  | 'PRICE_ASC' | 'PRICE_DESC' | 'COST_ASC' | 'COST_DESC';

export type ListStatus = 'ALL' | 'NEEDS_WORK' | 'WEBSITE' | 'ORDER_APP' | 'INACTIVE';

/** A category id, 'none' for the products without one, null for all. */
export type ListCategory = number | 'none' | null;

export interface ListState {
  q: string;
  category: ListCategory;
  status: ListStatus;
  sort: ListSort;
  /** Series and products whose fold was toggled by hand, as "f12" (series) or "p33" (product). */
  open: string[];
}

export const DEFAULT_LIST_STATE: Readonly<ListState> = { q: '', category: null, status: 'ALL', sort: 'STOCK_SMART', open: [] };

const SORT_WORDS: Readonly<Record<Exclude<ListSort, 'STOCK_SMART'>, string>> = {
  NAME_ASC: 'naam',
  NAME_DESC: 'naam-za',
  SKU: 'sku',
  STOCK_DESC: 'voorraad-hoog',
  STOCK_ASC: 'voorraad-laag',
  PRICE_ASC: 'prijs-laag',
  PRICE_DESC: 'prijs-hoog',
  COST_ASC: 'kost-laag',
  COST_DESC: 'kost-hoog',
};

const STATUS_WORDS: Readonly<Record<Exclude<ListStatus, 'ALL'>, string>> = {
  NEEDS_WORK: 'aandacht',
  WEBSITE: 'website',
  ORDER_APP: 'orderapp',
  INACTIVE: 'inactief',
};

/** The ten orders with the labels both lists use; the default first. */
export const SORT_OPTIONS: readonly { key: ListSort; label: string }[] = [
  { key: 'STOCK_SMART', label: 'Standaardvolgorde (voorraad eerst)' },
  { key: 'NAME_ASC', label: 'Naam A–Z' },
  { key: 'NAME_DESC', label: 'Naam Z–A' },
  { key: 'SKU', label: 'SKU' },
  { key: 'STOCK_DESC', label: 'Voorraad hoog → laag' },
  { key: 'STOCK_ASC', label: 'Voorraad laag → hoog' },
  { key: 'PRICE_ASC', label: 'Catalogusprijs laag → hoog' },
  { key: 'PRICE_DESC', label: 'Catalogusprijs hoog → laag' },
  { key: 'COST_ASC', label: 'Kostprijs laag → hoog' },
  { key: 'COST_DESC', label: 'Kostprijs hoog → laag' },
];

/** The short label on the sort button: "Standaardvolgorde", else the option's own. */
export function sortButtonLabel(sort: ListSort): string {
  return sort === 'STOCK_SMART' ? 'Standaardvolgorde' : SORT_OPTIONS.find((option) => option.key === sort)?.label ?? 'Standaardvolgorde';
}

export const STATUS_OPTIONS: readonly { key: ListStatus; label: string }[] = [
  { key: 'ALL', label: 'Alle statussen' },
  { key: 'WEBSITE', label: 'Website live' },
  { key: 'ORDER_APP', label: 'Orderapp live' },
  { key: 'INACTIVE', label: 'Inactief' },
];

function first(value: string | readonly string[] | null | undefined): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
  return typeof value === 'string' ? value : '';
}

/** The state from route query params; unknown values fall back to the default. */
export function readListQuery(params: Readonly<Record<string, string | readonly string[] | null | undefined>>): ListState {
  const sortWord = first(params['volgorde']).trim().toLowerCase();
  const sort = (Object.entries(SORT_WORDS).find(([, word]) => word === sortWord)?.[0] as ListSort | undefined) ?? 'STOCK_SMART';
  const statusWord = first(params['status']).trim().toLowerCase();
  const status = (Object.entries(STATUS_WORDS).find(([, word]) => word === statusWord)?.[0] as ListStatus | undefined) ?? 'ALL';
  const categoryWord = first(params['categorie']).trim().toLowerCase();
  const categoryId = /^\d+$/.test(categoryWord) ? Number(categoryWord) : NaN;
  const category: ListCategory = categoryWord === 'geen' ? 'none'
    : Number.isSafeInteger(categoryId) && categoryId > 0 ? categoryId : null;
  const open = [...new Set(first(params['open']).split(',').map((key) => key.trim()).filter((key) => /^[fp]\d+$/.test(key)))];
  return { q: first(params['q']).slice(0, 200), category, status, sort, open };
}

/** The query params for a state: defaults left out, so a plain list keeps a plain address. */
export function listQueryParams(state: ListState): Record<string, string> {
  const params: Record<string, string> = {};
  if (state.q.trim()) params['q'] = state.q.trim();
  if (state.category === 'none') params['categorie'] = 'geen';
  else if (state.category !== null) params['categorie'] = String(state.category);
  if (state.status !== 'ALL') params['status'] = STATUS_WORDS[state.status];
  if (state.sort !== 'STOCK_SMART') params['volgorde'] = SORT_WORDS[state.sort];
  if (state.open.length) params['open'] = state.open.join(',');
  return params;
}

/** "?q=bowl&volgorde=naam", or '' for the defaults. */
export function listQueryString(state: ListState): string {
  const params = listQueryParams(state);
  const parts = Object.entries(params).map(([key, value]) =>
    `${key}=${encodeURIComponent(value).replace(/%2C/gi, ',')}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/** The columns whose header sorts. */
export type SortColumn = 'name' | 'stock' | 'cost' | 'price';

const COLUMN_CYCLE: Readonly<Record<SortColumn, readonly [ListSort, ListSort]>> = {
  name: ['NAME_ASC', 'NAME_DESC'],
  stock: ['STOCK_DESC', 'STOCK_ASC'],
  cost: ['COST_DESC', 'COST_ASC'],
  price: ['PRICE_DESC', 'PRICE_ASC'],
};

/** A header click: first order, then the reverse, then back to the standard order. */
export function nextHeaderSort(column: SortColumn, current: ListSort): ListSort {
  const [one, two] = COLUMN_CYCLE[column];
  return current === one ? two : current === two ? 'STOCK_SMART' : one;
}

/** aria-sort for a header: only on the column the list is sorted by. */
export function headerAriaSort(column: SortColumn, current: ListSort): 'ascending' | 'descending' | null {
  const [one, two] = COLUMN_CYCLE[column];
  if (current !== one && current !== two) return null;
  return current.endsWith('ASC') ? 'ascending' : 'descending';
}

/**
 * The one row of a table that takes Tab (roving tabindex): the row last
 * focused while it is still on screen, else the first row. A row that a
 * delete, a fold or a filter took away never leaves the table without a
 * way in. Shared by Producten and Voorraad.
 */
export function rovingRow(focused: string | null, shown: ReadonlySet<string>, first: string | null): string | null {
  return focused !== null && shown.has(focused) ? focused : first;
}
