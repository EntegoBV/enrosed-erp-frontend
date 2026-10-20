import type { WebsitePageRow } from '../../core/api/analytics-api';
import type { Customer, Product, ProductFamily, SalesOrderView } from '../../core/api/models';

/**
 * The small sums behind the website report's headline cards, and the rows
 * behind its two drill-downs (design/analyses2/design.md §B.10). Pure and
 * type-only, so the tests can read them.
 */
export interface Delta {
  pct: number;
  direction: 'up' | 'down' | 'flat';
}

const WHOLE = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 0 });
const ONE_DECIMAL = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 1 });
/** The site's languages besides English, which lives at the root (as WebsiteVisitService.SITE_LOCALES). */
const SITE_LOCALES = ['nl', 'fr', 'de', 'es', 'pl', 'pt', 'tr', 'el'];

/** Up or down against the period before; null when there is nothing to compare with. */
export function deltaOf(current: number, previous: number): Delta | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  return { pct, direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}

/** "1 min 20 s", "45 s"; a dash when nothing was measured. */
export function durationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes === 0) return `${rest} s`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/** "▲ 12 %", "▼ 3 %", "= 0 %": a figure's change; the tool row says once against what (design §C.10). */
export function deltaShort(current: number, previous: number): string {
  const delta = deltaOf(current, previous);
  if (!delta) return 'geen vergelijking';
  const arrow = delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '=';
  return `${arrow} ${WHOLE.format(Math.abs(delta.pct))} %`;
}

/** The tool row's basis: "t.o.v. vorige 30 dagen"; Vandaag compares with yesterday until the same clock time (D-W3). */
export function compareLine(days: number): string {
  return days === 1 ? 't.o.v. gisteren' : `t.o.v. vorige ${WHOLE.format(days)} dagen`;
}

/** "12 %": part of a whole, rounded; "0 %" without a whole. */
export function shareLabel(part: number, total: number): string {
  return total > 0 ? `${WHOLE.format(Math.round((part / total) * 100))} %` : '0 %';
}

/** "43,5 % na één pagina": the sub of Pagina's per sessie, as nl-BE writes it (D-W6). */
export function bounceLine(bounceRatePct: number, sessions: number): string {
  if (!(sessions > 0) || !Number.isFinite(bounceRatePct)) return 'nog geen sessies';
  return `${ONE_DECIMAL.format(bounceRatePct)} % na één pagina`;
}

/** The middle of the per-day axis: the busiest day, or "geen bezoeken" when the window is empty (D-W7). */
export function peakLine(perDay: readonly { visits: number }[]): string {
  const peak = Math.max(0, ...perDay.map((day) => (Number.isFinite(day.visits) ? day.visits : 0)));
  return peak > 0 ? `piek ${WHOLE.format(peak)} op een dag` : 'geen bezoeken';
}

/* ---------------------------------------------------------------- sources */

export interface WebsiteSourceShare {
  source: string;
  kind: string;
  sessions: number;
  share: string;
}

/** Vanwaar · bronnen: since D-W1 a source is booked once, on a session's first page, so its share is of the sessions. */
export function sourceShares(sources: readonly { source: string; kind: string; visits: number }[], sessions: number): WebsiteSourceShare[] {
  return sources.map((row) => ({ source: row.source, kind: row.kind, sessions: row.visits, share: shareLabel(row.visits, sessions) }));
}

/* ---------------------------------------------------------------- Aanvragen (website.requests) */

export interface WebsiteRequestRow {
  id: number;
  number: string;
  docType: 'OFFERTE' | 'FACTUUR';
  orderDate: string;
  customerId: number | null;
  /** The customer's company; null for a request without a customer yet. */
  customerName: string | null;
  countryCode: string | null;
  /** The products on the document, each once, in line order. */
  products: string[];
  /** The document total excl. btw (goods, freight and free lines). */
  valueExclEur: number;
  view: SalesOrderView;
}

/**
 * The requests the website brought in, counted in the ERP (design §B.10): a
 * document with website origin (`isWebsite`, passed in so this module needs
 * no runtime import), never a credit note, never an invoice made from a quote
 * (that quote counted already), dated in the report's window.
 */
export function websiteRequestRows(
  views: readonly SalesOrderView[],
  customers: readonly Customer[],
  options: { from: string; to: string; isWebsite: (view: SalesOrderView) => boolean },
): WebsiteRequestRow[] {
  const companies = new Map<number, string>();
  for (const customer of customers) if (customer.id !== null) companies.set(customer.id, customer.company);
  const rows: WebsiteRequestRow[] = [];
  for (const view of views) {
    const order = view.order;
    if (order.docType === 'CREDITNOTA' || order.sourceQuoteId) continue;
    const day = isoDay(order.orderDate);
    if (!day || day < options.from || day > options.to || !options.isWebsite(view)) continue;
    const products: string[] = [];
    const seen = new Set<number>();
    for (const line of view.priced?.lines ?? []) {
      if (seen.has(line.productId)) continue;
      seen.add(line.productId);
      const name = line.description?.trim() || line.sku?.trim();
      if (name) products.push(name);
    }
    const total = view.priced?.totals?.total;
    rows.push({
      id: order.id, number: order.number, docType: order.docType === 'FACTUUR' ? 'FACTUUR' : 'OFFERTE', orderDate: day,
      customerId: order.customerId, customerName: order.customerId === null ? null : companies.get(order.customerId) ?? null,
      countryCode: order.countryCode, products, valueExclEur: typeof total === 'number' && Number.isFinite(total) ? total : 0, view,
    });
  }
  return rows;
}

/* ---------------------------------------------------------------- Productpagina's (website.products) */

export interface WebsiteProductPageRow {
  /** The last path segment: the family's public handle. */
  handle: string;
  /** The site languages it was viewed in: English (the root) first, then in the site's order. */
  locales: string[];
  visits: number;
  /** Visitors added over the languages: an upper bound, one visitor may read two languages. */
  visitors: number;
}

/** One row per product over every language: /products/x/ and /nl/products/x/ are the same product (D-W11). */
export function productPageRows(pages: readonly WebsitePageRow[]): WebsiteProductPageRow[] {
  const rows = new Map<string, WebsiteProductPageRow>();
  for (const page of pages) {
    if (page.kind !== 'PRODUCT') continue;
    const parts = page.path.split('/').filter(Boolean);
    const handle = parts[parts.length - 1];
    if (!handle) continue;
    const locale = SITE_LOCALES.includes(parts[0]) ? parts[0] : 'en';
    const row = rows.get(handle) ?? { handle, locales: [], visits: 0, visitors: 0 };
    if (!row.locales.includes(locale)) row.locales.push(locale);
    row.visits += page.visits;
    row.visitors += page.visitors;
    rows.set(handle, row);
  }
  const order = ['en', ...SITE_LOCALES];
  return [...rows.values()].map((row) => ({ ...row, locales: [...row.locales].sort((a, b) => order.indexOf(a) - order.indexOf(b)) }));
}

export interface CatalogProductMatch {
  productId: number;
  name: string;
  sku: string | null;
  /** Active variants behind the page (1 for a product on its own). */
  variants: number;
}

/**
 * Handle → the ERP product behind the page: the family whose public handle it
 * is (its name, linked to its first active variant), else a product that
 * carries the handle itself.
 */
export function catalogByHandle(products: readonly Product[], families: readonly ProductFamily[]): Map<string, CatalogProductMatch> {
  const index = new Map<string, CatalogProductMatch>();
  const members = new Map<number, Product[]>();
  for (const product of products) {
    if (product.id === null || product.familyId === null) continue;
    const list = members.get(product.familyId) ?? [];
    list.push(product);
    members.set(product.familyId, list);
  }
  const first = (a: Product, b: Product) => Number(b.active) - Number(a.active)
    || (a.variantPosition ?? Number.MAX_SAFE_INTEGER) - (b.variantPosition ?? Number.MAX_SAFE_INTEGER) || (a.id ?? 0) - (b.id ?? 0);
  for (const family of families) {
    const handle = family.publicHandle?.trim().toLowerCase();
    if (!handle || family.id === null || index.has(handle)) continue;
    const variants = [...(members.get(family.id) ?? [])].sort(first);
    const lead = variants[0];
    if (!lead || lead.id === null) continue;
    index.set(handle, { productId: lead.id, name: family.name?.trim() || lead.name, sku: lead.sku,
      variants: Math.max(1, variants.filter((product) => product.active).length) });
  }
  for (const product of products) {
    const handle = product.publicHandle?.trim().toLowerCase();
    if (!handle || product.id === null || index.has(handle)) continue;
    index.set(handle, { productId: product.id, name: product.name, sku: product.sku, variants: 1 });
  }
  return index;
}

function isoDay(value: string | null | undefined): string | null {
  const day = typeof value === 'string' ? value.slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}
