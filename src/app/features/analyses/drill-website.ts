import type { DrillColumn, DrillRow, DrillView } from './drill-model';
import type { CatalogProductMatch, WebsiteProductPageRow, WebsiteRequestRow } from './website-analytics-math';

/**
 * Bezoekers' two drill-downs (design/analyses2/design.md §B.10): the requests
 * the website brought in (Aanvragen tile, last funnel step) and the product
 * pages per product (Productpagina's tile, funnel step). Pure with type-only
 * imports (node-tested); what needs Angular or a runtime import comes in from
 * the component: the scope text, a document's status words, country names.
 */

/** The website's own address for a product page the catalogue does not know (any more). */
export const WEBSITE_PRODUCT_BASE = 'https://www.enrosed.com/nl/products/';

const REQUEST_COLUMNS: readonly DrillColumn[] = [
  { key: 'doc', label: 'Document', format: 'text', phone: 'title' },
  { key: 'customer', label: 'Klant', format: 'text', phone: 'sub' },
  { key: 'date', label: 'Datum', format: 'day', phone: 'sub' },
  { key: 'country', label: 'Land', format: 'text', phone: 'none' },
  { key: 'products', label: 'Producten', format: 'text', phone: 'none' },
  { key: 'status', label: 'Status', format: 'text', phone: 'none' },
  { key: 'value', label: 'Bedrag excl.', format: 'eur', phone: 'value', sum: true },
];

/**
 * `website.requests`: one row per request, newest first. The figure is a
 * count, so the total counts rows (the tile's own number); the Bedrag column
 * adds up to the tile's "€ X excl. btw".
 */
export function websiteRequestsView(rows: readonly WebsiteRequestRow[], context: {
  scope: string;
  /** The tile's figure, from the same rows. */
  count: number;
  status: (row: WebsiteRequestRow) => string;
  countryName: (code: string) => string;
}): DrillView {
  return {
    id: 'website.requests',
    title: 'Aanvragen via de website',
    scope: context.scope,
    columns: REQUEST_COLUMNS,
    rows: rows.map((row): DrillRow => ({
      key: `doc-${row.id}`,
      cells: {
        doc: row.number, customer: row.customerName ?? 'Nieuwe klant', date: row.orderDate,
        country: row.countryCode ? context.countryName(row.countryCode) : null,
        products: productsText(row.products) || null, status: context.status(row), value: row.valueExclEur,
      },
      pill: row.docType === 'FACTUUR' ? 'Factuur' : null,
      link: { path: ['/sales', row.id] },
    })),
    valueKey: null,
    total: { value: context.count, format: 'int', of: 'rows', label: 'Aanvragen' },
    sort: { key: 'date', dir: 'desc' },
    empty: 'Geen aanvragen in deze periode.',
  };
}

/** "Rozenbox, Glazen stolp +2": the first two products and how many more. */
export function productsText(products: readonly string[]): string {
  const shown = products.slice(0, 2).join(', ');
  return products.length > 2 ? `${shown} +${products.length - 2}` : shown;
}

const PRODUCT_COLUMNS: readonly DrillColumn[] = [
  { key: 'product', label: 'Product', format: 'text', phone: 'title' },
  { key: 'sku', label: 'SKU', format: 'text', phone: 'sub' },
  { key: 'langs', label: 'Talen', format: 'text', phone: 'none' },
  { key: 'visitors', label: 'Bezoekers', format: 'int', phone: 'none' },
  { key: 'views', label: 'Weergaven', format: 'int', phone: 'value' },
];

/**
 * `website.products`: the product pages grouped per product over every
 * language. The figure is every view of a product page (the report's
 * PRODUCT kind); the server lists the busiest 200 paths, so what falls
 * below that list shows as one gap row "Overige productpagina's".
 */
export function websiteProductsView(rows: readonly WebsiteProductPageRow[], context: {
  scope: string;
  /** Σ views of the PRODUCT kind (`report.kinds`): the figure the rows add up to. */
  productViews: number;
  catalog: ReadonlyMap<string, CatalogProductMatch>;
}): DrillView {
  return {
    id: 'website.products',
    title: 'Bekeken producten',
    scope: context.scope,
    columns: PRODUCT_COLUMNS,
    rows: rows.map((row): DrillRow => {
      const match = context.catalog.get(row.handle.toLowerCase()) ?? null;
      return {
        key: `page-${row.handle}`,
        cells: {
          product: match?.name ?? row.handle.replace(/-/g, ' '),
          sku: match ? (match.variants > 1 ? `${match.sku ?? '—'} +${match.variants - 1}` : match.sku) : null,
          langs: row.locales.map((locale) => locale.toUpperCase()).join(' · '),
          visitors: row.visitors,
          views: row.visits,
        },
        link: match ? { path: ['/products', match.productId] } : { href: `${WEBSITE_PRODUCT_BASE}${encodeURIComponent(row.handle)}/` },
      };
    }),
    valueKey: 'views',
    total: { value: context.productViews, format: 'int', of: 'sum' },
    gapLabel: 'Overige productpagina’s',
    sort: { key: 'views', dir: 'desc' },
    empty: 'Geen productpagina’s bekeken in deze periode.',
  };
}
