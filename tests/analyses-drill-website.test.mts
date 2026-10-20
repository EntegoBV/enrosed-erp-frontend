import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  catalogByHandle, productPageRows, shareLabel, sourceShares, websiteRequestRows,
} from '../src/app/features/analyses/website-analytics-math.ts';
import { WEBSITE_PRODUCT_BASE, productsText, websiteProductsView, websiteRequestsView } from '../src/app/features/analyses/drill-website.ts';
import { hasWebsiteCustomerMessage, isWebOrder } from '../src/app/features/sales/quote-status.ts';
import type { Customer, Product, ProductFamily, SalesOrderView } from '../src/app/core/api/models.ts';
import type { WebsitePageRow } from '../src/app/core/api/analytics-api.ts';
import type { DrillView } from '../src/app/features/analyses/drill-model.ts';

/* Analyses round 2 · Bezoekers (design/analyses2/design.md §B.10): the two drill-downs and their rows. */

const fromWebsite = (view: SalesOrderView) => hasWebsiteCustomerMessage(view.order) || isWebOrder(view);
const window = { from: '2026-09-22', to: '2026-10-21', isWebsite: fromWebsite };

function doc(id: number, order: Record<string, unknown>, extra: Record<string, unknown> = {}, lines: [number, string][] = [[1, 'Rozenbox rood']], total = 1000): SalesOrderView {
  return {
    order: { id, number: `D-${id}`, customerId: 7, countryCode: 'DE', orderDate: '2026-10-01', status: 'VERZONDEN', docType: 'OFFERTE',
      salesChannel: 'WEBSITE', internalNotes: null, sourceQuoteId: null, lines: [], pallets: [], ...order },
    priced: { lines: lines.map(([productId, description]) => ({ productId, sku: `SKU-${productId}`, description })), totals: { total } },
    awaitingResend: false, ...extra,
  } as unknown as SalesOrderView;
}

const views: SalesOrderView[] = [
  doc(1, { orderDate: '2026-10-03' }, {}, [[1, 'Rozenbox rood'], [2, 'Glazen stolp'], [1, 'Rozenbox rood'], [3, 'Hartdoos'], [4, 'Kaars']], 1200),
  doc(2, { orderDate: '2026-10-10', salesChannel: null, status: 'CONCEPT', customerId: null, internalNotes: '[WEBSITE_AANVRAAG]\nVan het formulier' }, {}, [[2, 'Glazen stolp']], 300.4),
  doc(3, { orderDate: '2026-09-22', salesChannel: 'DIRECT' }, { webOrder: { customerEditable: true, revision: 1 } }, [[3, 'Hartdoos']], 250),
  // An invoice made from quote 1: that quote counted already.
  doc(4, { orderDate: '2026-10-12', docType: 'FACTUUR', sourceQuoteId: 1 }, {}, [[1, 'Rozenbox rood']], 1200),
  // A credit note is never a request, whatever its channel.
  doc(5, { orderDate: '2026-10-13', docType: 'CREDITNOTA' }, {}, [[1, 'Rozenbox rood']], -200),
  // Not from the website.
  doc(6, { orderDate: '2026-10-14', salesChannel: 'FAIR' }),
  // Outside the window, on both sides.
  doc(7, { orderDate: '2026-09-21' }),
  doc(8, { orderDate: '2026-10-22' }),
  // A website invoice without a quote before it counts, as an invoice.
  doc(9, { orderDate: '2026-10-21', docType: 'FACTUUR', customerId: 8 }, {}, [[4, 'Kaars']], 99.6),
];
const customers = [{ id: 7, company: 'Blumen Berlin GmbH' }, { id: 8, company: 'Fleurs Lyon' }] as unknown as Customer[];

test('a request is a website document in the window: never a credit note, never an invoice made from a quote', () => {
  const rows = websiteRequestRows(views, customers, window);
  assert.deepEqual(rows.map((row) => row.id), [1, 2, 3, 9]);
  assert.equal(rows.find((row) => row.id === 2)!.customerName, null, 'a request without a customer yet');
  assert.equal(rows.find((row) => row.id === 9)!.docType, 'FACTUUR');
  assert.deepEqual(rows[0].products, ['Rozenbox rood', 'Glazen stolp', 'Hartdoos', 'Kaars'], 'each product once, in line order');
  assert.equal(rows.reduce((sum, row) => sum + row.valueExclEur, 0), 1200 + 300.4 + 250 + 99.6);
  assert.deepEqual(websiteRequestRows(views, customers, { ...window, from: '2026-10-21' }).map((row) => row.id), [9], 'Vandaag: today only');
});

test('a document the server derives from a request is no new request: a voorschot- or slotfactuur, the later part of a split', () => {
  const quote = doc(20, { orderDate: '2026-10-02' }, {}, [[1, 'Rozenbox rood']], 100_000);
  /* The voorschotfactuur keeps the quote's channel and has no sourceQuoteId (SalesAdvanceBillingService). */
  const advance = doc(21, { orderDate: '2026-10-05', docType: 'FACTUUR' }, { advanceBilling: { stage: 'ADVANCE', quoteId: 20, quoteNumber: 'D-20', percentage: 30, amountExclEur: 30_000 } },
    [[1, 'Rozenbox rood']], 30_000);
  /* A split's second part: a copy with the channel, without the quote link (SalesSplits); part 1 is the original document. */
  const later = doc(22, { orderDate: '2026-10-06', docType: 'FACTUUR' }, { fulfillment: { groupId: 'g', rootOrderId: 20, part: 2, status: 'WAITING_FOR_STOCK', siblingId: 23,
    siblingNumber: 'D-23', financialsLocked: true } }, [[2, 'Glazen stolp']], 4_000);
  const first = doc(23, { orderDate: '2026-10-06', docType: 'FACTUUR' }, { fulfillment: { groupId: 'g', rootOrderId: 20, part: 1, status: 'PLANNED', siblingId: 22,
    siblingNumber: 'D-22', financialsLocked: true } }, [[1, 'Rozenbox rood']], 6_000);
  const rows = websiteRequestRows([quote, advance, later, first], customers, window);
  assert.deepEqual(rows.map((row) => row.id), [20, 23], 'the quote and an invoice without a quote link; never the voorschot or part 2');
  assert.equal(rows.reduce((sum, row) => sum + row.valueExclEur, 0), 106_000, 'the tile\'s € no longer adds the voorschot');
});

test('the requests view counts its rows, links each document and adds up the amounts (A.4)', () => {
  const rows = websiteRequestRows(views, customers, window);
  const view = websiteRequestsView(rows, { scope: '30 dagen · 22 sep – 21 okt 2026 · op documentdatum · excl. btw', count: rows.length,
    status: (row) => row.view.order.status === 'CONCEPT' ? 'Nieuwe aanvraag' : 'Verzonden', countryName: (code) => code === 'DE' ? 'Duitsland' : code });
  assert.equal(view.id, 'website.requests');
  assert.deepEqual(view.columns.map((column) => column.key), ['doc', 'customer', 'date', 'country', 'products', 'status', 'value']);
  assert.deepEqual(view.total, { value: 4, format: 'int', of: 'rows', label: 'Aanvragen' });
  assert.equal(view.rows.length, view.total!.value, 'the rows are the tile count');
  assert.equal(view.valueKey, null);
  assert.equal(view.columns.find((column) => column.key === 'value')!.sum, true, 'the Bedrag column adds up to the tile sub');
  assert.equal(view.columns.find((column) => column.key === 'value')!.phone, 'value');
  assert.deepEqual(view.sort, { key: 'date', dir: 'desc' });
  assert.deepEqual(view.rows.map((row) => row.link), rows.map((row) => ({ path: ['/sales', row.id] })));
  const two = view.rows.find((row) => row.key === 'doc-2')!;
  assert.equal(two.cells['customer'], 'Nieuwe klant');
  assert.equal(two.cells['status'], 'Nieuwe aanvraag');
  const one = view.rows.find((row) => row.key === 'doc-1')!;
  assert.equal(one.cells['products'], 'Rozenbox rood, Glazen stolp +2');
  assert.equal(one.cells['country'], 'Duitsland');
  assert.equal(one.cells['customer'], 'Blumen Berlin GmbH');
  assert.equal(view.rows.find((row) => row.key === 'doc-9')!.pill, 'Factuur');
  assert.equal(one.pill, null);
  const sum = view.rows.reduce((total, row) => total + Number(row.cells['value']), 0);
  assert.ok(Math.abs(sum - 1850) < 0.005);
  const empty = websiteRequestsView([], { scope: 's', count: 0, status: () => '', countryName: (code) => code });
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.empty, 'Geen aanvragen in deze periode.');
});

test('products text: the first two and how many more', () => {
  assert.equal(productsText([]), '');
  assert.equal(productsText(['A']), 'A');
  assert.equal(productsText(['A', 'B']), 'A, B');
  assert.equal(productsText(['A', 'B', 'C']), 'A, B +1');
});

const pages: WebsitePageRow[] = [
  { path: '/products/rose-box/', kind: 'PRODUCT', visits: 40, visitors: 30 },
  { path: '/nl/products/rose-box/', kind: 'PRODUCT', visits: 25, visitors: 20 },
  { path: '/de/products/rose-box/', kind: 'PRODUCT', visits: 10, visitors: 9 },
  { path: '/fr/products/glass-dome/', kind: 'PRODUCT', visits: 12, visitors: 11 },
  { path: '/products/retired-heart/', kind: 'PRODUCT', visits: 3, visitors: 3 },
  { path: '/nl/', kind: 'HOME', visits: 90, visitors: 70 },
  { path: '/nl/products/', kind: 'PRODUCTS', visits: 50, visitors: 40 },
];

test('one row per product over every language (D-W11)', () => {
  const rows = productPageRows(pages);
  assert.deepEqual(rows.map((row) => row.handle), ['rose-box', 'glass-dome', 'retired-heart']);
  const rose = rows[0];
  assert.equal(rose.visits, 75);
  assert.equal(rose.visitors, 59, 'visitors added over the languages: an upper bound');
  assert.deepEqual(rose.locales, ['en', 'nl', 'de']);
  assert.deepEqual(rows[1].locales, ['fr']);
});

const product = (id: number, familyId: number | null, extra: Partial<Product> = {}) =>
  ({ id, familyId, name: `Variant ${id}`, sku: `SKU-${id}`, active: true, variantPosition: id, publicHandle: null, ...extra }) as unknown as Product;
const products = [
  product(11, 1, { active: false, variantPosition: 0 }), product(12, 1, { variantPosition: 2 }), product(13, 1, { variantPosition: 1 }),
  product(21, 2), product(31, null, { name: 'Glazen stolp', publicHandle: 'glass-dome' }),
];
const families = [
  { id: 1, publicHandle: 'rose-box', name: 'Rozenbox' }, { id: 2, publicHandle: null, name: 'Zonder handle' },
] as unknown as ProductFamily[];

test('a handle finds its ERP product: the family by its public handle (first active variant), else the product itself', () => {
  const index = catalogByHandle(products, families);
  assert.deepEqual(index.get('rose-box'), { productId: 13, name: 'Rozenbox', sku: 'SKU-13', variants: 2 });
  assert.deepEqual(index.get('glass-dome'), { productId: 31, name: 'Glazen stolp', sku: 'SKU-31', variants: 1 });
  assert.equal(index.get('retired-heart'), undefined);
  assert.equal(index.size, 2);
});

function viewOf(productViews: number): DrillView {
  return websiteProductsView(productPageRows(pages), { scope: '30 dagen · eigen meting', productViews, catalog: catalogByHandle(products, families) });
}

test('the product view adds up to the PRODUCT kind; what fell below the 200 paths is the named gap (A.4)', () => {
  const view = viewOf(95);
  assert.equal(view.id, 'website.products');
  assert.equal(view.valueKey, 'views');
  assert.deepEqual(view.total, { value: 95, format: 'int', of: 'sum' });
  const sum = view.rows.reduce((total, row) => total + Number(row.cells['views']), 0);
  assert.equal(sum, 90);
  assert.equal(view.total!.value - sum, 5, 'the gap row the dialog shows');
  assert.equal(view.gapLabel, 'Overige productpagina’s');
  assert.equal(viewOf(90).total!.value - sum, 0, 'no gap when every path is listed');
  assert.deepEqual(view.sort, { key: 'views', dir: 'desc' });
  assert.deepEqual(view.columns.map((column) => [column.key, column.format, column.phone]),
    [['product', 'text', 'title'], ['sku', 'text', 'sub'], ['langs', 'text', 'none'], ['visitors', 'int', 'none'], ['views', 'int', 'value']]);
  assert.ok(view.columns.every((column) => !column.sum), 'visitors over products are no sum');
});

test('a known product links to the ERP, an unknown handle to its page on the website', () => {
  const view = viewOf(90);
  const [rose, dome, retired] = view.rows;
  assert.deepEqual(rose.link, { path: ['/products', 13] });
  assert.equal(rose.cells['product'], 'Rozenbox');
  assert.equal(rose.cells['sku'], 'SKU-13 +1');
  assert.equal(rose.cells['langs'], 'EN · NL · DE');
  assert.deepEqual(dome.link, { path: ['/products', 31] });
  assert.equal(dome.cells['sku'], 'SKU-31');
  assert.deepEqual(retired.link, { href: 'https://www.enrosed.com/nl/products/retired-heart/' });
  assert.equal(retired.link && 'href' in retired.link ? retired.link.href.startsWith(WEBSITE_PRODUCT_BASE) : false, true);
  assert.equal(retired.cells['product'], 'retired heart');
  assert.equal(retired.cells['sku'], null);
  /* From the funnel step (sessions), the summary names the clicked figure beside the views (A.4). */
  const fromFunnel = websiteProductsView(productPageRows([]), { scope: 's', productViews: 640, catalog: new Map(), productSessions: 120 });
  assert.equal(fromFunnel.summary, '120 sessies openden een productpagina · 640 weergaven');
  assert.equal(viewOf(95).summary, null, 'the kind tile is views already: no summary');
  const empty = websiteProductsView([], { scope: 's', productViews: 0, catalog: new Map() });
  assert.equal(empty.empty, 'Geen productpagina’s bekeken in deze periode.');
});

test('sources share the sessions: booked once per session since D-W1, they add up to them', () => {
  const sources = [{ source: 'Google', kind: 'SEARCH', visits: 30 }, { source: 'Rechtstreeks', kind: 'DIRECT', visits: 15 }, { source: 'Instagram', kind: 'SOCIAL', visits: 5 }];
  const rows = sourceShares(sources, 50);
  assert.deepEqual(rows.map((row) => row.share), ['60 %', '30 %', '10 %']);
  assert.equal(rows.reduce((sum, row) => sum + row.sessions, 0), 50);
  assert.equal(shareLabel(1, 0), '0 %');
});

const read = (path: string) => fs.readFileSync(new URL(`../src/app/features/analyses/${path}`, import.meta.url), 'utf8');

test('the row and view modules import types only (node-tested, no runtime import)', () => {
  for (const file of ['drill-website.ts', 'website-analytics-math.ts']) {
    const imports = read(file).match(/^import .*$/gm) ?? [];
    assert.ok(imports.length > 0);
    for (const line of imports) assert.match(line, /^import type /, `${file}: ${line}`);
  }
});

test('Bezoekers: the drill triggers, the tool row and no footer (analyses2 C.10)', () => {
  const source = read('website-analytics.ts');
  const template = source.match(/template:\s*`([\s\S]*?)`,\s*styles:/)![1];
  assert.match(template, /<button type="button" class="an-kpi an-kpi--drill" aria-haspopup="dialog" \(click\)="openRequests\(\)"><span class="an-kpi__label">Aanvragen<\/span>/);
  assert.match(template, /class="wa__kind wa__kind--drill" aria-haspopup="dialog"/);
  assert.match(template, /class="wa__funnel-step wa__funnel-step--drill" aria-haspopup="dialog"/);
  assert.match(template, /<ng-content select="\[how\]" \/>/);
  assert.match(template, /<button class="wk-btn wk-btn--ghost" type="button" \(click\)="excludeThisDevice\(\)">Dit toestel uitsluiten<\/button>/);
  assert.match(template, /\{\{ compare\(\) \}\} · bijgewerkt \{\{ timeLabel\(r\.generatedAt\) \}\}/);
  assert.doesNotMatch(template, /wa__source-hint|wa__foot|Unieke bezoekers|Offerte-interesse|Sessieduur|Landen in totaal|Contactpagina geopend/);
  for (const label of ['Bezoekers', 'Sessies', 'Paginaweergaven', 'Pagina’s per sessie', 'Offertepagina geopend', 'Aanvragen']) {
    assert.match(template, new RegExp(`<span class="an-kpi__label">${label}</span>`), label);
  }
  assert.match(source, /label: 'Aanvraag verstuurd'/, 'the funnel ends with the requests the ERP received');
  assert.match(template, /Taal van de site/);
  assert.match(template, /per sessie/);
  assert.match(source, /reload\(true\)/, 'Vernieuwen passes the minute memory');
});
