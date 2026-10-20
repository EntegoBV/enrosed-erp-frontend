import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompanyCost, Customer, PurchaseOrderView, SalesOrderView } from '../src/app/core/api/models.ts';
import type { TicaAnalyticsDay } from '../src/app/core/api/tica-api.ts';
import type { DrillView } from '../src/app/features/analyses/drill-model.ts';
import { receivedContainerRows, resultAnalysis, resultCostRows, salesAnalysis, salesDocumentRows } from '../src/app/features/analyses/analysis-metrics.ts';
import type { CostCharge } from '../src/app/features/analyses/analysis-metrics.ts';
import { withTicaResult } from '../src/app/features/analyses/tica-analysis.ts';
import { columnSum, drillGap, drillTable } from '../src/app/features/analyses/drill-table.ts';
import { categoryView, channelView, costsView, generalCostsView, monthView, receivedView } from '../src/app/features/analyses/drill-result.ts';
import type { ResultDrillContext } from '../src/app/features/analyses/drill-result.ts';
import { marginViews, revenueViews, ticaMonthRows } from '../src/app/features/analyses/drill-sales.ts';
import { costChargeIn, openOf } from '../src/app/features/finance/finance-metrics.ts';

/*
 * Resultaat's drill-downs (design/analyses2/design.md §B.4): every view's rows, plus its named gap, add up to the
 * figure resultAnalysis / withTicaResult give the tile, row or month that opens it (rule A.4). A credit note shows no
 * result; the costs split as Kosten per categorie splits them (an investment by its depreciation).
 */

interface Doc {
  id: number; kind?: 'FACTUUR' | 'CREDITNOTA' | 'OFFERTE'; date: string; customer?: number; channel?: string | null;
  revenue?: number; cost?: number; profit?: number; total?: number; missing?: string[]; purpose?: 'PARTNER_ADVANCE'; container?: number;
}

function doc(input: Doc): SalesOrderView {
  const kind = input.kind ?? 'FACTUUR';
  const quote = kind === 'OFFERTE';
  return {
    order: { id: input.id, number: `${kind === 'CREDITNOTA' ? 'CN' : quote ? 'OFF' : 'INV'}-${input.id}`, customerId: input.customer ?? 1, countryCode: 'BE',
      orderDate: input.date, status: quote ? 'CONCEPT' : 'VERZONDEN', docType: kind, salesChannel: input.channel ?? null, purpose: input.purpose ?? null,
      partnerPurchaseOrderId: input.container ?? null, viewCount: 0 },
    priced: { lines: [], totals: { total: input.total ?? input.revenue ?? 0, totalInclVat: input.total ?? input.revenue ?? 0, goodsTotal: 0, marginEur: 0, pieces: 0, costTotal: 0 },
      validation: { productsWithoutCost: input.missing ?? [] } },
    accounting: quote ? undefined : { recognizedRevenueEur: input.revenue ?? 0, recognizedCostEur: input.cost ?? 0, recognizedProfitEur: input.profit ?? 0, recognizedQuantity: 0 },
  } as unknown as SalesOrderView;
}

const base = { category: 'BOEKHOUDER', description: 'Kost', party: null, vatPct: 21, reference: null, paidOn: null, salesChannel: null, notes: null, amountInclEur: null,
  vatRegime: 'BE', vatRegimeConfirmed: true, supplierCountry: 'BE', costKind: null, expenseType: 'STANDARD', vatDeductiblePct: 100, taxDeductiblePct: 100,
  depreciationYears: null, depreciationStart: null } as const;

const today = '2026-10-20';
const from = '2026-09-01';
const to = today;
const customers = [{ id: 1, company: 'Bloemen BV' }, { id: 2, company: 'Fleur GmbH' }] as Customer[];
const sales: SalesOrderView[] = [
  doc({ id: 1, date: '2026-09-05', revenue: 1000, cost: 700, profit: 300 }),
  doc({ id: 2, date: '2026-10-02', customer: 2, channel: 'WEBSITE', revenue: 500, cost: 300, profit: 200 }),
  doc({ id: 3, kind: 'CREDITNOTA', date: '2026-10-10', customer: 2, channel: 'website', revenue: -100, cost: -60, profit: -40 }),
  /* A partner voorschot: no revenue, no margin, and its line without a cost never makes the margin "—" (D-O7). */
  doc({ id: 4, date: '2026-09-20', total: 5000, purpose: 'PARTNER_ADVANCE', container: 9, missing: ['X-1'] }),
  doc({ id: 6, date: '2026-08-01', revenue: 900, profit: 400 }),
  doc({ id: 7, kind: 'OFFERTE', date: '2026-10-01', total: 800 }),
];
const costs: CompanyCost[] = [
  { ...base, id: 1, date: '2026-09-15', amountExclEur: 100, description: 'Kwartaal', party: 'Boekhouder NV' },
  { ...base, id: 2, date: '2026-07-01', amountExclEur: 3000, category: 'SOFTWARE', description: 'Laptop', costKind: 'INVESTMENT', depreciationYears: 3,
    depreciationStart: '2026-07-01', paidOn: '2026-07-01', openEur: 0 },
  { ...base, id: 3, date: '2026-10-02', amountExclEur: 0, vatPct: null, amountInclEur: 500, category: 'TRANSPORT', description: 'Invoer-btw', vatRegime: 'IMPORT_VAT_PAID' },
  { ...base, id: 4, date: '2026-10-05', amountExclEur: 250, category: 'BEURS', description: 'Stand', salesChannel: 'TICA', paidOn: '2026-10-06', openEur: 0 },
  { ...base, id: 5, date: '2026-10-08', amountExclEur: 60, category: 'MARKETING', description: 'Advertenties', salesChannel: 'WEBSITE' },
  { ...base, id: 6, date: '2026-08-15', amountExclEur: 900, category: 'HUUR', description: 'Augustus' },
] as CompanyCost[];
const purchases = [
  { order: { id: 1, number: 'PO-1', alias: 'container/2026/001', status: 'ONTVANGEN', supplierId: 3, receivedOn: '2026-09-10' },
    costing: { totals: { totalEur: 3900 } }, reconciliation: { totals: { forecastExternalEur: 4000, finalized: true } } },
  { order: { id: 2, number: 'PO-2', alias: null, status: 'ONTVANGEN', supplierId: 4, receivedOn: '2026-10-01', partnerCustomerId: 7 },
    costing: { totals: { totalEur: 2900, totalWithSeparateCostsEur: 3000, extraRevenueEur: 200 } }, reconciliation: null },
  { order: { id: 3, number: 'PO-3', alias: null, status: 'ONDERWEG', supplierId: 3, receivedOn: null }, costing: { totals: { totalEur: 1000 } } },
  { order: { id: 4, number: 'PO-4', alias: null, status: 'ONTVANGEN', supplierId: 3, receivedOn: '2026-08-01' }, costing: { totals: { totalEur: 1000 } } },
] as unknown as PurchaseOrderView[];
const days: TicaAnalyticsDay[] = [
  { date: '2026-09-14', transactionCount: 3, quantity: 5, revenueExcl: 120, goodsCostEur: 40, missingCostLines: 0 },
  { date: '2026-10-02', transactionCount: 2, quantity: 2, revenueExcl: 80, goodsCostEur: 30, missingCostLines: 0 },
];

const charge: CostCharge = (cost, start, end) => costChargeIn(cost, start, end, today);
const options = { from, to, costCharge: charge, openEur: openOf, today };
const r = withTicaResult(resultAnalysis(sales, purchases, costs, options), days);
const rows = resultCostRows(costs, options);
const docs = salesDocumentRows(sales, customers, { from, to, today });
const tica = ticaMonthRows(days, from, to);
const ctx: ResultDrillContext = { period: 'Sinds 1 sep · 1 sep – 20 okt 2026', channelName: (code) => code === 'DIRECT' ? 'Rechtstreeks' : code,
  categoryName: (code) => code === 'AFSCHRIJVINGEN' ? 'Afschrijvingen' : code.toLowerCase(), costsQuery: { view: 'costs', tab: 'company', from, to, period: null } };

/** The A.4 rule on a view: Σ rows plus the named gap is the figure (to the cent); returns the gap. */
function adds(view: DrillView): number {
  const gap = drillGap(view);
  assert.ok(gap, `${view.id} has a figure`);
  const sum = view.total!.of === 'rows' ? view.rows.length : columnSum(view.rows, view.valueKey!);
  assert.ok(Math.abs(sum + gap.value - view.total!.value) < 0.01, `${view.id}: Σ ${sum} + gap ${gap.value} = ${view.total!.value}`);
  return gap.value;
}

const monthCosts = (month: string) => {
  const [year, index] = month.split('-').map(Number);
  const first = `${month}-01`, last = `${month}-${String(new Date(Date.UTC(year, index, 0)).getUTCDate()).padStart(2, '0')}`;
  return resultCostRows(costs, { ...options, from: from > first ? from : first, to: to < last ? to : last });
};

test('resultCostRows: Σ amount is costsEur with the investment by its depreciation, Σ open is unpaidCostsEur', () => {
  const total = rows.reduce((sum, row) => sum + row.amountEur, 0);
  assert.ok(Math.abs(total - r.costsEur) < 0.01, `${total} = ${r.costsEur}`);
  assert.ok(Math.abs(rows.reduce((sum, row) => sum + (row.openEur ?? 0), 0) - r.unpaidCostsEur) < 0.01);
  const laptop = rows.filter((row) => row.id === 2);
  assert.deepEqual(laptop.map((row) => [row.part, row.categoryKey, row.openEur]), [['depreciation', 'AFSCHRIJVINGEN', null]], 'bought in July: only its depreciation, no open amount');
  assert.ok(Math.abs(laptop[0].amountEur - r.depreciationEur) < 0.01);
  const vat = rows.filter((row) => row.id === 3);
  assert.deepEqual(vat.map((row) => [row.amountEur, row.openEur, row.categoryKey]), [[0, 500, 'TRANSPORT']], 'import VAT: no cost, still open');
  assert.equal(rows.find((row) => row.id === 6), undefined, 'August is outside the window');
  assert.deepEqual(rows.find((row) => row.id === 5)?.channel, 'WEBSITE');
  for (const category of r.byCategory) {
    const sum = rows.filter((row) => row.categoryKey === category.category).reduce((acc, row) => acc + row.amountEur, 0);
    assert.ok(Math.abs(sum - category.amountEur) < 0.01, `${category.category}: ${sum} = ${category.amountEur}`);
  }
});

test('Eigen kosten: grouped in Kosten per categorie order, the open column adds up to the open costs; each category opens its own', () => {
  const view = costsView(rows, r.byCategory.map((row) => row.category), r.costsEur, ctx);
  assert.equal(adds(view), 0);
  const table = drillTable(view);
  assert.ok(Math.abs(table.total!.sums['open'] - r.unpaidCostsEur) < 0.01, 'Open incl. total = unpaidCostsEur');
  assert.deepEqual(table.sections.map((section) => section.key), [...r.byCategory.map((row) => row.category), 'TRANSPORT'], 'a category of open costs only comes last');
  assert.deepEqual(view.rows.find((row) => row.key === 'c1')?.link, { path: ['/costs'], query: { cost: 1 } });
  assert.deepEqual(view.foot?.link, { path: ['/costs'], query: ctx.costsQuery });
  assert.deepEqual(view.sort, { key: 'amount', dir: 'desc' });
  for (const category of r.byCategory) {
    const one = categoryView(category.category, rows, category.amountEur, ctx);
    assert.equal(adds(one), 0);
    const query = (one.foot!.link as { query: Record<string, unknown> }).query;
    assert.equal(query['cat'], category.category === 'AFSCHRIJVINGEN' ? undefined : category.category, 'Kosten & bank opens on the category; Afschrijvingen has none there');
  }
  assert.equal(costsView([], [], 0, ctx).empty, 'Geen kosten in deze periode.');
});

test('a month: its documents, TICA and costs add up to its result; a credit note shows none and is the gap', () => {
  const active = r.monthly.filter((row) => row.revenueEur !== 0 || row.costsEur !== 0);
  assert.deepEqual(active.map((row) => row.month), ['2026-09', '2026-10']);
  for (const month of active) {
    const view = monthView(month.month, month.month, docs, tica, monthCosts(month.month), { resultEur: month.resultEur, complete: true }, ctx);
    const gap = adds(view);
    assert.ok(Math.abs(columnSum(view.rows, 'revenue') - month.revenueEur) < 0.01, `${month.month}: the Omzet column is the month's omzet`);
    if (month.month === '2026-10') {
      assert.equal(gap, -40, 'the credit note');
      assert.equal(drillTable(view).gap?.label, 'Creditnota’s');
      const credit = view.rows.find((row) => row.key === 'd3')!;
      assert.equal(credit.cells['result'], null, 'a credit note never shows a margin');
      assert.equal(credit.pill, 'Creditnota');
    } else assert.equal(gap, 0);
  }
  const october = monthView('2026-10', 'okt 2026', docs, tica, monthCosts('2026-10'), { resultEur: 0, complete: true }, ctx);
  assert.equal(october.rows.some((row) => row.key === 'd4'), false, 'a voorschot moves nothing');
  assert.deepEqual(october.rows.find((row) => row.key === 't2026-10')?.link, { path: ['/tica'], query: { from: '2026-10-01', to: today } });
  assert.equal(october.rows.some((row) => row.cells['result'] === 0 && row.group === 'costs'), false, 'an open cost of € 0 is no movement of the month');
  assert.deepEqual(october.sort, { key: 'date', dir: 'asc' });
  const incomplete = monthView('2026-10', 'okt 2026', docs, tica, monthCosts('2026-10'), { resultEur: 0, complete: false }, ctx);
  assert.equal(incomplete.total, null, 'a missing product cost: rows without a total');
  assert.equal(incomplete.summary, 'Onvolledig: productkosten ontbreken');
});

test('Per verkoopkanaal: each channel adds up to its result; with Algemene kosten the channels add up to Resultaat (D-O5)', () => {
  const sum = r.byChannel.reduce((acc, row) => acc + row.resultEur, 0) - r.generalCostsEur;
  assert.ok(Math.abs(sum - r.resultEur) < 0.01, `Σ channels − algemene kosten ${sum} = ${r.resultEur}`);
  for (const row of r.byChannel.filter((channel) => channel.revenueEur !== 0 || channel.costsEur !== 0)) {
    const view = channelView(row.channel, docs, tica, rows, { resultEur: row.resultEur, complete: true }, ctx);
    const gap = adds(view);
    assert.equal(gap, row.channel === 'WEBSITE' ? -40 : 0, `${row.channel}: only the credit note is a gap`);
    assert.deepEqual((view.foot!.link as { query: Record<string, unknown> }).query['channel'], row.channel);
  }
  const ticaView = channelView('TICA', docs, tica, rows, { resultEur: 0, complete: true }, ctx);
  assert.deepEqual(ticaView.rows.map((row) => row.key).sort(), ['c4', 't2026-09', 't2026-10'], 'its TICA months and the stand');
  assert.equal(ticaView.rows.find((row) => row.key === 'c4')?.cells['result'], -250, 'a cost is minus');
  const general = generalCostsView(rows, r.generalCostsEur, ctx);
  assert.equal(adds(general), 0);
  assert.ok(r.generalCostsEur > 100, 'the accountant and the laptop');
  assert.equal(general.total?.value, -r.generalCostsEur);
  assert.equal(general.rows.some((row) => row.key === 'c3'), false, 'import VAT is no cost');
  assert.equal(general.rows.find((row) => row.key === 'c2:a')?.cells['what'], 'Laptop · afschrijving', 'the date is the first column: the word goes after the description');
  assert.equal(channelView('DIRECT', docs, tica, rows, { resultEur: 0, complete: true }, ctx).rows.length, 1, 'no cost is booked on Rechtstreeks');
  assert.equal(monthView('2026-09', 'sep 2026', docs, tica, monthCosts('2026-09'), { resultEur: 0, complete: true }, ctx).rows.find((row) => row.key === 'c2:a')?.pill,
    'Afschrijving', 'in a month the description is the first column');
});

test('receivedContainerRows: the received containers of the window add up to purchasedEur (Containers ontvangen)', () => {
  const received = receivedContainerRows(purchases, { from, to });
  assert.deepEqual(received.map((row) => [row.id, row.externalCostEur, row.finalized, row.partner]), [[1, 4000, true, false], [2, 2800, false, true]]);
  assert.equal(r.purchasedEur, 6800);
  assert.equal(r.receivedContainers, 2);
  const view = receivedView(received, r.purchasedEur, ctx, { container: (row) => row.alias ?? row.number, supplier: (id) => `Leverancier ${id}`, amount: (value) => `€ ${value}` });
  assert.equal(adds(view), 0);
  assert.equal(view.summary, 'waarvan partner € 2800');
  assert.deepEqual(view.rows.map((row) => [row.cells['name'], row.cells['state'], row.pill]), [['container/2026/001', 'Afgerekend', null], ['PO-2', 'Voorlopig', 'Partner']]);
  assert.deepEqual(view.rows[1].link, { path: ['/purchasing', 2] });
  assert.deepEqual(view.sort, { key: 'received', dir: 'desc' });
  assert.equal(receivedView([], 0, ctx, { container: String, supplier: String, amount: String }).summary, null);
});

test('Omzet and Marge op goederen open Verkoop\'s views with Resultaat\'s figures: the same documents add up to them', () => {
  const [perDocument] = revenueViews(docs, tica, r.revenueEur, { period: ctx.period, channelName: ctx.channelName }, to);
  assert.equal(adds(perDocument), 0);
  const [margin] = marginViews(docs, tica, [], { marginEur: r.marginEur, marginPct: r.marginPct, missingCostLines: r.missingCostLines },
    { period: ctx.period, channelName: ctx.channelName }, to, null);
  assert.equal(margin.id, 'sales.margin');
  assert.equal(adds(margin), -40, 'the credit note is the margin\'s gap');
});

test('D-O7, D-O4, Omzet\'s count: Resultaat reads Verkoop\'s missing-cost rule, per channel too, and counts revenue invoices', () => {
  assert.equal(r.missingCostLines, 0, 'the voorschot\'s line without a cost does not count');
  const verkoop = salesAnalysis(sales, customers, { from, to, today });
  assert.equal(r.missingCostLines, verkoop.invoices.missingCostLines);
  assert.equal(r.invoiceCount, 3, 'every issued invoice, the voorschot included');
  assert.equal(r.revenueInvoiceCount, 2, 'the invoices that move the omzet');
  const missing = [...sales, doc({ id: 8, date: '2026-10-12', revenue: 400, profit: 400, missing: ['S-14', 'S-15'] })];
  const withMissing = resultAnalysis(missing, [], [], { from, to, today });
  assert.equal(withMissing.missingCostLines, 2);
  assert.deepEqual(withMissing.byChannel.map((row) => [row.channel, row.missingCostLines]), [['DIRECT', 2], ['WEBSITE', 0]], 'the channel with the lines reads "—"');
  assert.equal(withTicaResult(withMissing, days).byChannel.find((row) => row.channel === 'TICA')?.missingCostLines, 0);
});
