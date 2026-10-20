import assert from 'node:assert/strict';
import test from 'node:test';
import type { Customer, PricedLine, QuoteStatus, SalesOrderView } from '../src/app/core/api/models.ts';
import type { TicaAnalyticsDay } from '../src/app/core/api/tica-api.ts';
import type { DrillView } from '../src/app/features/analyses/drill-model.ts';
import {
  missingCostRows, openPipelineQuotes, salesAnalysis, salesDocumentRows, salesLineRows,
} from '../src/app/features/analyses/analysis-metrics.ts';
import { withTicaSales } from '../src/app/features/analyses/tica-analysis.ts';
import { columnSum, drillGap, drillTable } from '../src/app/features/analyses/drill-table.ts';
import {
  acceptedView, channelView, countryView, customerView, funnelView, invoicedView, marginViews, missingCostView, openInvoicesView, openQuotesView, overdueView,
  productView, revenueViews, ticaMonthRows, ticaUnmatchedView,
} from '../src/app/features/analyses/drill-sales.ts';
import type { SalesDrillContext } from '../src/app/features/analyses/drill-sales.ts';
import type { TicaProductRow } from '../src/app/features/analyses/tica-breakdown.ts';

/*
 * Verkoop's drill-downs (design/analyses2/design.md §B.1–B.3): every view's rows, plus its named gap, add up to the
 * figure the tile shows as salesAnalysis / withTicaSales compute it (rule A.4). A credit note never shows a margin;
 * a partner voorschot is financing and stays out of Omzet and Marge.
 */

interface Doc {
  id: number; kind?: 'OFFERTE' | 'FACTUUR' | 'CREDITNOTA'; status?: QuoteStatus; date: string; customer?: number | null; country?: string | null;
  channel?: string | null; total?: number; claim?: number; goods?: number; margin?: number; pieces?: number;
  revenue?: number; cost?: number; profit?: number; quantity?: number;
  received?: number; due?: string | null; missing?: string[]; lines?: Partial<PricedLine>[];
  purpose?: 'STANDARD' | 'PARTNER_ADVANCE' | 'PARTNER_SETTLEMENT'; container?: number; containerName?: string;
  sent?: boolean; viewed?: boolean; decidedAt?: string; invoicedAs?: string; invoicedAsId?: number;
}

function doc(input: Doc): SalesOrderView {
  const kind = input.kind ?? 'FACTUUR';
  const total = input.total ?? 0;
  const claim = input.claim ?? total;
  const quote = kind === 'OFFERTE';
  return {
    order: {
      id: input.id, number: `${kind === 'CREDITNOTA' ? 'CN' : quote ? 'OFF' : 'INV'}-${input.id}`, customerId: input.customer === undefined ? 1 : input.customer,
      countryCode: input.country ?? 'BE', orderDate: input.date, validUntil: '2026-12-31', status: input.status ?? (quote ? 'CONCEPT' : 'VERZONDEN'),
      docType: kind, salesChannel: input.channel ?? null, invoiceDueDate: input.due ?? null, purpose: input.purpose ?? null,
      partnerPurchaseOrderId: input.container ?? null, partnerSettlement: input.purpose === 'PARTNER_SETTLEMENT',
      sentAt: input.sent ? `${input.date}T10:00:00Z` : null, viewedAt: input.viewed ? `${input.date}T11:00:00Z` : null, viewCount: input.viewed ? 2 : 0,
      decidedAt: input.decidedAt ? `${input.decidedAt}T09:00:00Z` : null,
    },
    priced: {
      lines: (input.lines ?? []).map((line, index) => ({ productId: 90 + index, sku: `SKU-${90 + index}`, description: `Product ${90 + index}`, quantity: 1, net: 0, marginEur: 0, ...line })),
      totals: { total, totalInclVat: claim, goodsTotal: input.goods ?? total, marginEur: input.margin ?? 0, pieces: input.pieces ?? 0, costTotal: 0 },
      validation: { productsWithoutCost: input.missing ?? [] },
    },
    accounting: quote ? undefined : { recognizedRevenueEur: input.revenue ?? 0, recognizedCostEur: input.cost ?? 0, recognizedProfitEur: input.profit ?? 0,
      recognizedQuantity: input.quantity ?? 0 },
    paymentSummary: quote ? undefined : { invoiceTotalEur: kind === 'CREDITNOTA' ? -claim : claim, receivedEur: input.received ?? 0,
      remainingEur: kind === 'CREDITNOTA' ? 0 : Math.max(0, claim - (input.received ?? 0)), overpaidEur: 0, creditEur: 0, status: 'UNPAID', payments: [], instalments: [],
      legacyPaidMarker: false },
    partnerContainerName: input.containerName ?? null,
    invoicedAs: input.invoicedAs ?? null,
    invoicedAsId: input.invoicedAsId ?? null,
    awaitingResend: false,
  } as unknown as SalesOrderView;
}

const today = '2026-10-20';
const period = { from: '2026-01-01', to: today, today };
const customers = [{ id: 1, company: 'Bloemen BV' }, { id: 2, company: 'Fleur GmbH' }, { id: 3, company: 'Partner NV' }] as Customer[];
const orders: SalesOrderView[] = [
  doc({ id: 1, date: '2026-03-10', customer: 1, total: 1000, claim: 1210, revenue: 1000, cost: 700, profit: 300, quantity: 100, due: '2026-04-10',
    lines: [{ productId: 11, sku: 'R-11', description: 'Roos oud', quantity: 100, net: 1000 }] }),
  doc({ id: 2, date: '2026-05-05', customer: 2, country: 'DE', channel: 'website', total: 500, goods: 450, revenue: 500, cost: 300, profit: 200, quantity: 50,
    received: 500, status: 'BETAALD', lines: [{ productId: 11, sku: 'R-11', quantity: 20, net: 200 }, { productId: 12, sku: 'B-12', quantity: 30, net: 300 }] }),
  doc({ id: 3, kind: 'CREDITNOTA', status: 'UITGEREIKT', date: '2026-05-20', customer: 2, country: 'DE', channel: 'WEBSITE', total: 100, revenue: -100, cost: -60, profit: -40,
    quantity: -10, lines: [{ productId: 12, sku: 'B-12', quantity: 10, net: 100 }] }),
  doc({ id: 4, date: '2026-06-01', customer: 3, total: 5000, purpose: 'PARTNER_ADVANCE', container: 9, containerName: 'Half Heart Mix', due: '2026-12-01' }),
  doc({ id: 5, date: '2026-09-01', customer: 3, channel: 'PARTNER', total: 300, claim: 363, revenue: 3300, cost: 3000, profit: 300, quantity: 100,
    purpose: 'PARTNER_SETTLEMENT', container: 9, lines: [{ productId: 13, sku: 'H-13', quantity: 100, net: 3300 }] }),
  doc({ id: 6, status: 'CONCEPT', date: '2026-07-01', total: 999, revenue: 999 }),
  doc({ id: 7, date: '2026-10-01', customer: 1, total: 400, claim: 484, revenue: 400, profit: 400, quantity: 4, due: '2026-10-31', missing: ['S-14'],
    lines: [{ productId: 14, sku: 'S-14', description: 'Schaal', quantity: 4, net: 400 }] }),
  doc({ id: 8, date: '2025-11-15', customer: 1, total: 200, claim: 242, revenue: 200, profit: 50, due: '2025-12-15' }),
  doc({ id: 10, kind: 'OFFERTE', date: '2026-08-01', total: 900, margin: 300 }),
  doc({ id: 11, kind: 'OFFERTE', status: 'VERZONDEN', date: '2026-09-01', total: 600, margin: 100, sent: true, missing: ['X'] }),
  doc({ id: 12, kind: 'OFFERTE', status: 'GEACCEPTEERD', date: '2026-03-01', total: 1000, margin: 350, sent: true, viewed: true, decidedAt: '2026-03-04',
    invoicedAs: 'INV-1', invoicedAsId: 1 }),
  doc({ id: 13, kind: 'OFFERTE', status: 'AFGEWEZEN', date: '2026-04-01', total: 300, sent: true }),
  doc({ id: 14, kind: 'OFFERTE', status: 'GEANNULEERD', date: '2026-04-02', total: 50 }),
  doc({ id: 15, kind: 'OFFERTE', status: 'VERZONDEN', date: '2026-06-01', customer: 3, total: 5000, purpose: 'PARTNER_ADVANCE', container: 9, sent: true }),
  doc({ id: 16, kind: 'OFFERTE', status: 'BEKEKEN', date: '2025-12-01', total: 250, viewed: true }),
];
const days: TicaAnalyticsDay[] = [
  { date: '2026-09-14', transactionCount: 3, quantity: 5, revenueExcl: 120, goodsCostEur: 40, missingCostLines: 0 },
  { date: '2026-10-02', transactionCount: 2, quantity: 2, revenueExcl: 80, goodsCostEur: 30, missingCostLines: 1 },
  { date: '2025-12-30', transactionCount: 9, quantity: 9, revenueExcl: 999, goodsCostEur: 1, missingCostLines: 0 },
];
const ctx: SalesDrillContext = { period: 'Dit jaar · 1 jan – 20 okt 2026', channelName: (code) => code === 'DIRECT' ? 'Rechtstreeks' : code };
const m = withTicaSales(salesAnalysis(orders, customers, { ...period, topLimit: 8 }), days);
const all = salesAnalysis(orders, customers, { today, topLimit: 1 });
const docs = salesDocumentRows(orders, customers, period);
const allDocs = salesDocumentRows(orders, customers, { today });
const tica = ticaMonthRows(days, period.from, period.to);

/** The A.4 rule on a view: Σ rows plus the named gap is the figure; returns the gap. */
function adds(view: DrillView): number {
  const gap = drillGap(view);
  assert.ok(gap, `${view.id} has a figure`);
  const rows = view.total!.of === 'rows' ? view.rows.length : columnSum(view.rows, view.valueKey!);
  assert.ok(Math.abs(rows + gap.value - view.total!.value) < 0.005, `${view.id}: Σ ${rows} + gap ${gap.value} = ${view.total!.value}`);
  return gap.value;
}

test('salesDocumentRows: quotes of every status and issued invoices and credit notes of the window, on the figures\' own rules', () => {
  assert.deepEqual(docs.map((row) => row.id), [1, 2, 3, 4, 5, 7, 10, 11, 12, 13, 14, 15], 'no concept invoice, nothing outside the window');
  const byId = new Map(docs.map((row) => [row.id, row]));
  assert.equal(byId.get(3)!.marginEur, null, 'a credit note shows no margin');
  assert.equal(byId.get(3)!.claimInclEur, -100, 'a credit note takes its claim back');
  assert.equal(byId.get(4)!.advance, true);
  assert.equal(byId.get(4)!.marginEur, null, 'a partner voorschot shows no margin');
  assert.equal(byId.get(4)!.revenueExclEur, 0, 'and no revenue (documentAccounting)');
  assert.equal(byId.get(5)!.settlement, true);
  assert.equal(byId.get(15)!.partnerFunding, true);
  assert.equal(byId.get(1)!.overdueDays, 193, '10 apr → 20 okt');
  assert.equal(byId.get(7)!.overdueDays, null, 'not yet due');
  assert.deepEqual(byId.get(7)!.missingCostSkus, ['S-14']);
  assert.equal(byId.get(2)!.channel, 'WEBSITE');
  assert.equal(byId.get(11)!.quoteMarginEur, null, 'a quote without a cost has no margin');
  assert.equal(byId.get(12)!.decidedAt, '2026-03-04');
  assert.equal(byId.get(1)!.customerName, 'Bloemen BV');
  assert.equal(allDocs.length, docs.length + 2, 'every year: the 2025 invoice and quote too');
});

test('Omzet: the revenue documents and the TICA months add up to Omzet; a voorschot is no revenue', () => {
  const [perDocument, perCustomer] = revenueViews(docs, tica, m.revenueExclEur, ctx, period.to);
  assert.equal(m.revenueExclEur, 5300);
  assert.equal(adds(perDocument), 0);
  assert.equal(adds(perCustomer), 0);
  assert.ok(!perDocument.rows.some((row) => row.key === 'd4'), 'the partner voorschot is not in Omzet');
  assert.deepEqual(perDocument.groups?.map((group) => group.label), ['Facturen', 'TICA']);
  assert.deepEqual(perDocument.rows.filter((row) => row.group === 'tica').map((row) => [row.cells['doc'], row.cells['revenue']]), [['TICA · sep', 120], ['TICA · okt', 80]]);
  assert.deepEqual(perDocument.rows.find((row) => row.key === 't2026-10')?.link, { path: ['/tica'], query: { from: '2026-10-01', to: '2026-10-20' } });
  assert.deepEqual(perDocument.rows.find((row) => row.key === 'd1')?.link, { path: ['/sales', 1] });
  assert.equal(perDocument.rows.find((row) => row.key === 'd3')?.pill, 'Creditnota');
  assert.deepEqual(perDocument.sort, { key: 'date', dir: 'desc' });
  assert.equal(perDocument.foot?.label, 'Verkooporders ›');
  assert.equal(m.invoices.revenueInvoiceCount, 4, 'Omzet\'s "n facturen" counts the revenue invoices (D-S6), not the voorschot');
  assert.equal(m.invoices.issued, 5, 'Gefactureerd still counts every issued invoice');
});

test('Brutomarge: with lines without a cost the list to fix comes first and counts them; per document the credit note is the gap', () => {
  assert.equal(m.missingCostLines, 2, 'one invoice line, one TICA line');
  const views = marginViews(docs, tica, missingCostRows(orders, period), m, ctx, period.to, { from: '2026-09-14', to: today });
  assert.deepEqual(views.map((view) => view.id), ['sales.missingCost', 'sales.margin']);
  const [missing, perDocument] = views;
  assert.equal(adds(missing), 0);
  assert.deepEqual(missing.rows.map((row) => [row.cells['product'], row.cells['lines'], row.link]),
    [['Schaal', 1, { path: ['/products', 14] }], ['TICA · 1 regel', 1, { path: ['/tica'], query: { from: '2026-09-14', to: today } }]]);
  /* The tile reads "—" while a cost is missing: the rows stand without a total (as Resultaat's month and channel views). */
  assert.equal(perDocument.total, null, 'no "Totaal" for a margin the tile does not show');
  assert.equal(drillTable(perDocument).total, null);
  assert.equal(Math.round((m.marginEur - columnSum(perDocument.rows, 'margin')) * 100) / 100, 10,
    'what the rows miss: the credit note (−40) and the October TICA margin without cost (50)');
  assert.equal(perDocument.gapLabel, 'Creditnota’s en TICA zonder kost');
  assert.equal(perDocument.rows.find((row) => row.key === 'd3')?.cells['margin'], null, 'a credit note never shows a margin');
  assert.ok(!perDocument.columns.some((column) => column.key === 'margin' && column.sum), 'the margin is the value, never a sum column beside a credit note');
  assert.equal(columnSum(perDocument.rows, 'revenue'), 5300, 'the Omzet column beside it');
});

test('Brutomarge without missing costs: per document and per customer, the credit note named as the gap', () => {
  const clean = orders.filter((row) => row.order.id !== 7);
  const cleanDays = days.map((day) => ({ ...day, missingCostLines: 0 }));
  const figure = withTicaSales(salesAnalysis(clean, customers, { ...period, topLimit: 8 }), cleanDays);
  const views = marginViews(salesDocumentRows(clean, customers, period), ticaMonthRows(cleanDays, period.from, period.to), [], figure, ctx, period.to, null);
  assert.deepEqual(views.map((view) => view.id), ['sales.margin', 'sales.margin.customer']);
  for (const view of views) {
    assert.equal(adds(view), -40);
    assert.equal(view.gapLabel, 'Creditnota’s');
  }
  assert.equal(views[0].summary, '18,2 % op goederen', 'marge 890 op omzet 4.900, as the tile');
});

test('Gefactureerd: every issued invoice (voorschot with its container) and credit note, incl. btw; the average of the regular invoices', () => {
  const view = invoicedView(docs, m.invoices.issuedValueEur, m.invoices.averageClaimEur, ctx, (value) => `€ ${value}`);
  assert.equal(m.invoices.issuedValueEur, 7457);
  assert.equal(adds(view), 0);
  const advance = view.rows.find((row) => row.key === 'd4')!;
  assert.equal(advance.pill, 'Voorschot');
  assert.equal(advance.cells['customer'], 'Partner NV · Half Heart Mix');
  assert.equal(m.invoices.averageClaimEur, (1210 + 500 + 363 + 484) / 4, 'the voorschot stays out of the average (D-S6)');
  assert.equal(view.summary, `gem. € ${(1210 + 500 + 363 + 484) / 4} per gewone factuur`);
  assert.equal(drillTable(view).total?.sums['outstanding'], 1210 + 5000 + 363 + 484);
});

test('a regular voorschotfactuur: omzet on its date (the server\'s recognition, as Hoe gerekend says); the average reads the slotfactuur before the deduction', () => {
  const billing = (stage: 'ADVANCE' | 'FINAL') => ({ stage, quoteId: 30, quoteNumber: 'OFF-30', percentage: stage === 'ADVANCE' ? 30 : null, amountExclEur: 30_000 });
  const advance = { ...doc({ id: 31, date: '2026-03-01', total: 30_000, claim: 36_300, revenue: 30_000, profit: 30_000 }), advanceBilling: billing('ADVANCE') } as SalesOrderView;
  const final = doc({ id: 32, date: '2026-06-01', total: 70_000, claim: 84_700, revenue: 70_000, cost: 70_000, profit: 0 });
  const slot = { ...final, priced: { ...final.priced, totals: { ...final.priced.totals, vatRatePct: 21 } }, advanceBilling: billing('FINAL') } as SalesOrderView;
  const plain = doc({ id: 33, date: '2026-07-01', total: 10_000, claim: 12_100, revenue: 10_000, cost: 7_000, profit: 3_000 });
  const result = salesAnalysis([advance, slot, plain], customers, { ...period, topLimit: 8 });
  assert.ok(Math.abs(result.invoices.averageClaimEur! - (84_700 + 30_000 * 1.21 + 12_100) / 2) < 0.005,
    'the slotfactuur counts as the whole sale (its claim plus the deducted voorschot incl. btw); the voorschotfactuur stays out');
  assert.equal(result.invoices.advanceClaimEur, 36_300);
  assert.equal(result.invoices.revenueExclEur, 110_000, 'omzet follows the server: the voorschot on its date, the slotfactuur net of it');
  assert.equal(result.invoices.revenueInvoiceCount, 3);
});

test('Open offertes: today\'s open regular quotes of every year add up to the pipeline; partner funding stays out', () => {
  const open = openPipelineQuotes(orders);
  const ids = new Set(open.map((row) => row.order.id));
  const figure = open.reduce((sum, row) => sum + row.priced.totals.total, 0);
  const view = openQuotesView(allDocs.filter((row) => ids.has(row.id)), figure, 'marge € 400');
  assert.equal(figure, 1750);
  assert.equal(adds(view), 0);
  assert.deepEqual(view.rows.map((row) => row.key).sort(), ['d10', 'd11', 'd16']);
  assert.equal(view.rows.find((row) => row.key === 'd11')?.cells['margin'], null, 'a quote without a cost has no margin');
  assert.deepEqual(view.foot?.link, { path: ['/sales'], query: { scope: 'STANDARD', tab: 'OFFERTE' } });
  assert.deepEqual(view.sort, { key: 'value', dir: 'desc' });
});

test('Geaccepteerd and the funnel steps: the period\'s regular quotes, the counts of salesAnalysis', () => {
  const accepted = acceptedView(docs, m.accepted.calculatedValueEur, ctx);
  assert.equal(adds(accepted), 0);
  assert.equal(accepted.rows[0].cells['invoice'], 'INV-1');
  for (const step of ['created', 'sent', 'viewed', 'rejected', 'expired', 'cancelled'] as const) {
    const view = funnelView(step, docs, m.funnel[step], ctx);
    assert.equal(adds(view), 0, step);
    assert.equal(view.valueKey, null);
  }
  assert.equal(m.funnel.created, 5);
  assert.equal(funnelView('expired', docs, 0, ctx).rows.length, 0);
  assert.equal(funnelView('expired', docs, 0, ctx).empty, 'Geen offertes in deze stap.');
});

test('Open facturen and Vervallen: today, every year, overdue first; the sums of allSales', () => {
  const open = openInvoicesView(allDocs, all.invoices.outstandingValueEur);
  assert.equal(all.invoices.outstandingValueEur, 1210 + 5000 + 363 + 484 + 242);
  assert.equal(adds(open), 0);
  const table = drillTable(open);
  assert.deepEqual(table.sections.map((section) => [section.group?.label, section.rows.map((row) => row.key)]),
    [['Vervallen', ['d8', 'd1']], ['Nog niet vervallen', ['d7', 'd4', 'd5']]], 'due day ascending, no due day last');
  const overdue = overdueView(allDocs, all.invoices.overdueValueEur);
  assert.equal(all.invoices.overdueValueEur, 1452);
  assert.equal(adds(overdue), 0);
  assert.deepEqual(overdue.rows.map((row) => row.tone), ['danger', 'danger']);
  assert.deepEqual(overdue.foot?.link, { path: ['/sales'], query: { scope: 'ALL', tab: 'FACTUUR', payment: 'open' } });
});

test('Omzet per kanaal: each channel\'s documents add up to its row; its own lines without cost (D-O4); no voorschot', () => {
  const channels = new Map(m.channels.map((row) => [row.channel, row]));
  assert.deepEqual([...channels.keys()].sort(), ['DIRECT', 'PARTNER', 'TICA', 'WEBSITE']);
  assert.equal(channels.get('DIRECT')!.missingCostLines, 1);
  assert.equal(channels.get('WEBSITE')!.missingCostLines, 0);
  assert.equal(channels.get('DIRECT')!.invoiceCount, 2, 'the voorschot is not a DIRECT invoice');
  for (const code of ['DIRECT', 'WEBSITE', 'PARTNER']) {
    const view = channelView(code, docs, channels.get(code)!.revenueExclEur, ctx);
    assert.equal(adds(view), 0, code);
  }
  assert.equal(channelView('DIRECT', docs, 1400, ctx).title, 'Omzet · Rechtstreeks');
});

test('Landen and Klanten: ranked by omzet excl. btw, a voorschot out (D-S5); their rows add up, grouped per customer', () => {
  assert.deepEqual(m.topCountries.map((row) => [row.countryCode, row.revenueExclEur]), [['BE', 4700], ['DE', 400]]);
  assert.deepEqual(m.topCustomers.map((row) => [row.customerId, row.revenueExclEur]), [[3, 3300], [1, 1400], [2, 400]]);
  const be = countryView('BE', 'België', docs, 4700, ctx);
  assert.equal(adds(be), 0);
  assert.deepEqual(be.groups?.map((group) => group.label), ['Partner NV', 'Bloemen BV'], 'the customer with the most omzet first');
  const partner = customerView(3, 'Partner NV', docs, 3300, ctx, (value) => `€ ${value}`);
  assert.equal(adds(partner), 0);
  assert.equal(partner.summary, 'marge 9,1 % · open € 5363', 'margin of the same rows (the voorschot shows none), open incl. the voorschot');
  assert.deepEqual(partner.foot?.link, { path: ['/customers'], query: { q: 'Partner NV' } });
  assert.equal(customerView(null, 'Geen klant', docs, 0, ctx, String).foot, null);
});

test('Producten: the product\'s lines with the list\'s goods factor add up to its figure; a credit note subtracts, a voorschot is out', () => {
  for (const product of m.topProducts) {
    const lines = salesLineRows(orders, product.productId, period);
    const view = productView(product.productId, product.name, lines, docs, product.calculatedGoodsValueEur, ctx, (_id, count) => `${count} st`);
    assert.equal(adds(view), 0, product.name);
  }
  const box = salesLineRows(orders, 12, period);
  assert.deepEqual(box.map((line) => [line.number, line.quantity, Math.round(line.goodsEur * 100) / 100, line.marginEur]), [['INV-2', 30, 270, 0], ['CN-3', -10, -100, null]]);
  const view = productView(12, 'Box', box, docs, 170, ctx, (_id, count) => `${count} st`);
  assert.equal(view.rows[1].pill, 'Creditnota');
  assert.equal(view.rows[1].cells['qty'], '-10 st');
  assert.deepEqual(view.foot?.link, { path: ['/products', 12] });
  assert.equal(view.note, 'TICA-verkopen staan op de TICA-kaart.');
});

test('TICA: months clipped to the period, a month with a line without cost has no margin; Niet herkend lists the articles', () => {
  assert.deepEqual(tica.map((row) => [row.month, row.from, row.to, row.revenueExclEur, row.marginEur]),
    [['2026-09', '2026-09-01', '2026-09-30', 120, 80], ['2026-10', '2026-10-01', '2026-10-20', 80, null]]);
  assert.equal(ticaMonthRows(days, null, null).length, 3, 'Alle jaren: every month');
  const products = [
    { key: 'p1', productId: 1, name: 'Roos', code: 'R', pieces: 3, netEur: 30, perPieceEur: 10, transactions: 1 },
    { key: 'ax', productId: null, name: 'Onbekend', code: 'B-9', pieces: 2, netEur: 18, perPieceEur: 9, transactions: 1 },
  ] as TicaProductRow[];
  const view = ticaUnmatchedView(products, 2, { from: '2026-09-01', to: today }, '1 sep – 20 okt 2026');
  assert.deepEqual(view.rows.map((row) => row.cells['name']), ['Onbekend · B-9']);
  assert.equal(view.total, null);
  assert.equal(view.summary, '2 regels zonder ERP-product');
  assert.deepEqual(view.foot?.link, { path: ['/tica'], query: { from: '2026-09-01', to: today } });
});

test('missingCostRows: per product, matched to its line by SKU, one line per SKU per document (the margin rule)', () => {
  const rows = missingCostRows([...orders, doc({ id: 20, date: '2026-10-05', total: 10, revenue: 10, missing: ['S-14', 'Z-1'],
    lines: [{ productId: 14, sku: 'S-14', quantity: 1, net: 10 }] })], period);
  assert.deepEqual(rows.map((row) => [row.key, row.productId, row.documents, row.lines]), [['p14', 14, 2, 2], ['sZ-1', null, 1, 1]]);
  assert.equal(missingCostView(rows, [], 3, ctx, null).rows[1].link, null, 'an SKU without a product line has nowhere to go');
});
