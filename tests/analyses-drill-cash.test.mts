import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import type { PurchaseOrderForecast } from '../src/app/core/api/models.ts';
import { NO_DEFAULTS, buildCashForecast, horizonEndOf } from '../src/app/features/finance/cash-forecast.ts';
import type { CashForecast, CashForecastInput, ForecastAccount, ForecastBankLine, ForecastMovement, ForecastOptions, ForecastOrder } from '../src/app/features/finance/cash-forecast.ts';
import { DEFAULT_CASH_LOCATION } from '../src/app/features/analyses/cash-url.ts';
import {
  cashCommittedView, cashLikelyPaidView, cashLowestView, cashMonthView, cashRuleView, cashScenarioSalesView, cashStockPlanView, drillLinkOf,
} from '../src/app/features/analyses/drill-cash.ts';
import type { CashDrillContext } from '../src/app/features/analyses/drill-cash.ts';
import type { DrillView } from '../src/app/features/analyses/drill-model.ts';

/*
 * The Kasprognose drill-downs (design/analyses2/design.md §B.8, rule A.4): every
 * view's rows (with the named gap) add up to the figure the screen shows, as
 * buildCashForecast computes it. cash-view.ts imports cash-forecast and
 * cash-format at runtime without an extension: transpiled as in cash-view.test.mts.
 */
const href = (path: string) => new URL(path, import.meta.url).href;
let source = await readFile(new URL('../src/app/features/analyses/cash-view.ts', import.meta.url), 'utf8');
source = source.replaceAll("'../finance/cash-forecast'", JSON.stringify(href('../src/app/features/finance/cash-forecast.ts')))
  .replaceAll("'../finance/cash-format'", JSON.stringify(href('../src/app/features/finance/cash-format.ts')));
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const view = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`) as typeof import('../src/app/features/analyses/cash-view.ts');
const format = await import('../src/app/features/finance/cash-format.ts');

/* ------------------------------------------------------------------ Example B and C (as in cash-view.test.mts) */

const TODAY = '2026-10-15';
const K = 'BE94731074082814';
const K_READING = Date.parse('2026-10-10T21:59:59.999Z');
const accounts = (k: Partial<ForecastAccount> = {}): ForecastAccount[] => [
  { key: K, label: 'KBC-zichtrekening', source: 'ODOO', archived: false, countsInCash: true, currentEur: 32365.27, checkedAt: new Date(K_READING).toISOString(),
    firstReadingAtMs: K_READING, latestReading: { atMs: K_READING, balanceEur: 40000 }, labelOnly: false, ...k },
];
const move = (id: number, at: string, day: string, amountEur: number): ForecastMovement => ({ key: `bank:${id}`, lineId: id, account: K, atMs: Date.parse(at), day, amountEur });
const MOVEMENTS = [move(101, '2026-10-07T22:00:00Z', '2026-10-08', -1500), move(102, '2026-10-08T22:00:00Z', '2026-10-09', 2000),
  move(103, '2026-10-12T22:00:00Z', '2026-10-13', -9000), move(104, '2026-10-13T22:00:00Z', '2026-10-14', 1452), move(105, '2026-10-13T22:00:00Z', '2026-10-14', -86.73)];
const line = (id: number, day: string, amountEur: number, counterparty: string, reference: string, kind: ForecastBankLine['parts'][number]['kind'], allocated = true): ForecastBankLine =>
  ({ id, account: K, day, amountEur, counterparty, reference, allocated, official: true, classification: null, transferLineId: null, parts: [{ kind, amountEur }], accountLabel: 'KBC-zichtrekening' });
const BANK_LINES = [line(101, '2026-10-08', -1500, 'Securex', 'Factuur september', 'COSTS'), line(102, '2026-10-09', 2000, 'Bloomstore GmbH', 'RE F2026-0376', 'CUSTOMERS'),
  line(103, '2026-10-13', -9000, 'Yunnan Pubei Flowers Co., Ltd', 'PO-2026-043 DEPOSIT 30PCT', 'COSTS', false),
  line(104, '2026-10-14', 1452, 'Bloemenatelier Lies BV', '+++412/0412/66087+++', 'CUSTOMERS'), line(105, '2026-10-14', -86.73, 'Proximus', 'Domiciliëring 6201554718', 'COSTS')];
const order43 = (extra: Partial<ForecastOrder> = {}): ForecastOrder => ({ orderId: 43, number: 'PO-2026-043', alias: null, status: 'BESTELD', partner: false, archived: false,
  supplierName: 'Yunnan Pubei Flowers Co., Ltd', orderDate: '2026-10-10', shippedOn: null, expectedArrival: '2027-01-08', receivedOn: null, leadTimeDays: 35, transitDays: 38,
  importVatEur: 7140, importVatCovered: false, clearance: 'BE_CUSTOMS', clearanceConfirmed: true, paidEur: 0, remainingEur: 37000, internalMarkupEur: 2500, lines: [], payments: [], ...extra });
const order41 = (): ForecastOrder => ({ orderId: 41, number: 'PO-2026-041', alias: null, status: 'ONDERWEG', partner: false, archived: false, supplierName: 'Ningbo Florals',
  orderDate: '2026-08-20', shippedOn: '2026-10-02', expectedArrival: '2026-11-18', receivedOn: null, leadTimeDays: 35, transitDays: 38, importVatEur: 3000, importVatCovered: false,
  clearance: 'NL_FISCAL_REP_TO_BE', clearanceConfirmed: true, paidEur: 20000, remainingEur: 11008.4, internalMarkupEur: 900, lines: [], payments: [] });
const monthly = (id: number, name: string, party: string, amountInclEur: number, day: number, autoPaid: boolean) => Array.from({ length: 13 }, (_, index) => {
  const month = 10 + index;
  const year = 2026 + Math.floor(month / 12);
  return { recurringId: id, name, party, date: `${year}-${String((month % 12) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, amountInclEur, autoPaid, intervalLabel: 'Maandelijks' };
});
const containerRow = (key: string, orderId: number, payee: 'SUPPLIER' | 'LOGISTICS' | 'SEPARATE', due: 'ORDERED' | 'SHIPPED' | 'ARRIVED' | null, termLabel: string | null, remainingEur: number) =>
  ({ key, orderId, payee, due, termLabel, remainingEur, concept: false });

function exampleB(extra: Partial<CashForecastInput> = {}): CashForecastInput {
  return {
    today: TODAY, statementsFrom: null, accounts: accounts(), movements: MOVEMENTS, bankLines: BANK_LINES,
    openCosts: [{ costId: 11, title: 'Boekhouder Q3', party: 'Fiduciaire Peeters', date: '2026-10-08', dueDate: null, openEur: 665.5 },
      { costId: 12, title: 'Brochures beurs', party: 'Vandersanden Drukwerk', date: '2026-10-13', dueDate: '2026-11-05', openEur: 423.5 }],
    recurring: [...monthly(3, 'Huur loods Wilrijk', 'Immo Wilrijk', 1452, 1, false), ...monthly(4, 'Proximus', 'Proximus', 86.73, 14, true)],
    containerRows: [containerRow('container:43:SUPPLIER:ORDERED', 43, 'SUPPLIER', 'ORDERED', '30% bij bestelling', 9000),
      containerRow('container:43:SUPPLIER:SHIPPED', 43, 'SUPPLIER', 'SHIPPED', '70% bij vertrek', 21000), containerRow('container:43:LOGISTICS', 43, 'LOGISTICS', null, null, 6400),
      containerRow('container:43:SEPARATE', 43, 'SEPARATE', null, null, 600), containerRow('container:41:SUPPLIER:ARRIVED', 41, 'SUPPLIER', 'ARRIVED', 'Saldo bij aankomst', 8690),
      containerRow('container:41:LOGISTICS', 41, 'LOGISTICS', null, null, 2318.4)],
    orders: [order43(), order41()],
    invoices: [
      { salesOrderId: 300, number: 'F2026-0300', party: 'Bloemen Maes', partner: false, advance: false, dueDate: '2026-05-20', remainingEur: 2000, delayDays: 0 },
      { salesOrderId: 405, number: 'F2026-0405', party: 'Maison Vert', partner: false, advance: false, dueDate: '2026-10-02', remainingEur: 1906, delayDays: 14 },
      { salesOrderId: 420, number: 'F2026-0420', party: 'Bloemen Lotus', partner: false, advance: false, dueDate: '2026-10-21', remainingEur: 4235, delayDays: 0 },
      { salesOrderId: 521, number: 'VF2026-0021', party: 'Kwekerij Van Gils', partner: true, advance: true, dueDate: '2026-11-05', remainingEur: 6050, delayDays: 0 },
    ],
    openCreditEur: 640,
    advanceRows: [{ orderId: 44, orderNumber: 'PO-2026-044', rowId: 7, label: '2e voorschot', party: 'Kwekerij Van Gils', dueDate: '2026-12-01', amountInclEur: 12100, vatEur: 2100 }],
    quotes: [{ salesOrderId: 390, number: 'OF2026-0390', party: 'Fleur de Paris', deliveryDate: null, deliveryWeek: '2026-W47', paymentTerms: '30 dagen netto', amountInclEur: 3267, vatEur: 567 }],
    openQuotes: [], vatQuarters: [{ year: 2026, quarter: 3, knownNetEur: -7412 }, { year: 2026, quarter: 4, knownNetEur: -2184.3 }],
    paidVatPeriods: [], importVatDeferred: false, products: [],
    history: { realisedMarkupPct: 50, paymentDays: 21, vatPct: 12, seasonal: null, openQuoteConversionPct: 40 },
    stored: [], bufferEur: 10000, outlook: { bankEur: 32365.27, expectedEur: 5880.14, netOpenEur: -37085.13, upcoming30Eur: 1538.73 },
    ...extra,
  };
}
const notIncluded: PurchaseOrderForecast = { orderId: 41, priceMode: null, markupPct: null, markupEurPerUnit: null, costBasis: null, sellWeeks: null, paymentDays: null,
  seasonal: null, included: false, expectedShipOn: null, orderDateOverride: null, updatedAt: null, actor: null };
const exampleC = () => exampleB({ stored: [notIncluded], orders: [order43({ lines: [
  { productId: 501, name: 'Rozendoos rond rood M', quantity: 2000, externalEur: 22200, pricingEur: 23700, listUnitEur: 18.5, historicUnitEur: null, paceUnitsPerWeek: 126, aheadUnits: 0 },
  { productId: 502, name: 'Mini dome blush', quantity: 2000, externalEur: 14800, pricingEur: 15800, listUnitEur: 12, historicUnitEur: 10.8, paceUnitsPerWeek: 91, aheadUnits: 0 },
] }), order41()] });
const options = (extra: Partial<ForecastOptions> = {}): ForecastOptions => ({ horizonEnd: horizonEndOf(TODAY, 6), scenario: false, includeStock: false, rulesOff: [],
  openQuotesOn: false, defaults: NO_DEFAULTS, dismissed: [], pastDays: 42, ...extra });
const base = buildCashForecast(exampleB(), options());
const scenario = buildCashForecast(exampleC(), options({ scenario: true }));

/* ------------------------------------------------------------------ helpers */

const opened: number[] = [];
const ctx: CashDrillContext = { day: format.dayMon, whole: format.eurWhole, itemLink: view.itemLink, lineLink: view.lineLink, openPo: (orderId) => opened.push(orderId) };
const plain = (text: string | null | undefined) => (text ?? '').replace(/[\u00a0\u202f]/g, ' ');
const cents = (value: unknown) => Math.round((typeof value === 'number' ? value : 0) * 100);
/** Σ of the view's value column in cents (null counts as 0), the way the dialog adds it. */
const sum = (drill: DrillView) => drill.rows.reduce((total, row) => total + cents(row.cells[drill.valueKey!]), 0);
const column = (drill: DrillView, key: string) => drill.rows.reduce((total, row) => total + cents(row.cells[key]), 0);
const rule = (forecast: CashForecast, key: string, location = DEFAULT_CASH_LOCATION) =>
  view.ruleSwitches(forecast, location, 40).find((row) => row.rule === key)!;
const sortedBy = (drill: DrillView, key: string) => drill.rows.every((row, index, rows) => index === 0 || String(rows[index - 1].cells[key]) <= String(row.cells[key]));

/* ------------------------------------------------------------------ tests */

test('Wat telt mee: a rule that is on lists the items it adds up, the total is its ruleTotal', () => {
  const invoices = cashRuleView(base, rule(base, 'invoices'), ctx);
  assert.equal(invoices.id, 'cash.rule.invoices');
  assert.equal(invoices.title, 'Open facturen');
  assert.equal(invoices.summary, null);
  assert.equal(sum(invoices), cents(base.ruleTotals.invoices));
  assert.deepEqual(invoices.total, { value: base.ruleTotals.invoices, format: 'eurSigned', of: 'sum' });
  /* The same items the forecast counts: the BASE items of the rule up to the horizon. */
  const counted = base.items.filter((item) => item.layer === 'BASE' && item.rule === 'invoices');
  assert.equal(sum(invoices), counted.reduce((total, item) => total + cents(item.amountEur), 0));
  assert.deepEqual(invoices.rows.map((row) => row.key), base.ruleItems.invoices.map((item) => item.key));
  assert.deepEqual(invoices.sort, { key: 'date', dir: 'asc' });
  assert.ok(sortedBy(invoices, 'date'));
  const lotus = invoices.rows.find((row) => row.cells['title'] === 'F2026-0420' || String(row.cells['title']).includes('F2026-0420'))!;
  assert.deepEqual(lotus.link, { path: ['/sales', 420], query: null });
  /* An overdue invoice sits on today with its pill. */
  assert.ok(invoices.rows.some((row) => row.pill === 'Vervallen' && row.cells['date'] === TODAY));
  assert.equal(invoices.valueKey, 'amount');
});

test('Wat telt mee: a rule that is off still lists its items and says it does not count', () => {
  const off = buildCashForecast(exampleB(), options({ rulesOff: ['costs'] }));
  assert.ok(off.items.every((item) => item.rule !== 'costs'), 'switched off: nothing of it in the forecast');
  const costs = cashRuleView(off, rule(off, 'costs', { ...DEFAULT_CASH_LOCATION, rulesOff: ['costs'] }), ctx);
  assert.equal(costs.summary, 'Staat uit: telt niet mee');
  assert.ok(costs.rows.length > 0);
  assert.equal(sum(costs), cents(off.ruleTotals.costs));
  assert.equal(off.ruleTotals.costs, base.ruleTotals.costs, 'the total does not depend on the switch');
  assert.deepEqual(costs.rows.find((row) => row.key === 'cost:11')!.link, { path: ['/costs'], query: { cost: 11 } });
  /* VAT off: the returns computed as if on, the same total. */
  const vatOff = buildCashForecast(exampleB(), options({ rulesOff: ['vat'] }));
  const vat = cashRuleView(vatOff, rule(vatOff, 'vat'), ctx);
  assert.equal(sum(vat), cents(vatOff.ruleTotals.vat));
  assert.equal(vatOff.ruleTotals.vat, base.ruleTotals.vat);
  assert.ok(vat.rows.length >= 2);
  /* A rule without items: the empty text, the total € 0. */
  const tica = cashRuleView(base, rule(base, 'tica'), ctx);
  assert.equal(tica.rows.length, 0);
  assert.equal(tica.total!.value, 0);
  assert.match(tica.empty, /^Niets in deze regel tot 15 apr\.$/);
});

test('Laagste stand: the bank today plus every movement up to the lowest day is the lowest stand', () => {
  const lowest = cashLowestView(scenario, ctx);
  assert.equal(lowest.id, 'cash.lowest');
  assert.equal(lowest.rows[0].key, 'today');
  assert.equal(lowest.rows[0].cells['amount'], scenario.startEur);
  assert.equal(lowest.rows[0].link, null);
  assert.equal(sum(lowest), cents(scenario.lowestWith.eur));
  assert.deepEqual(lowest.total, { value: scenario.lowestWith.eur, format: 'eur', of: 'sum', label: 'Laagste stand' });
  assert.ok(lowest.rows.every((row) => String(row.cells['date']) <= scenario.lowestWith.day));
  assert.ok(sortedBy(lowest, 'date'));
  /* The running saldo of the last row is the lowest stand itself. */
  assert.equal(lowest.rows.at(-1)!.cells['balance'], scenario.lowestWith.eur);
  /* A container term is a route to its payments. */
  assert.deepEqual(lowest.rows.find((row) => row.key === 'container:43:SUPPLIER:SHIPPED')!.link, { path: ['/costs'], query: { container: 43 } });
  /* Relative mode: no saldo, the rows add up to the difference from today. */
  const relative = buildCashForecast(exampleB({ accounts: accounts({ currentEur: null, latestReading: null, checkedAt: null }) }), options());
  const rel = cashLowestView(relative, ctx);
  assert.equal(rel.rows[0].cells['amount'], 0);
  assert.equal(rel.rows[0].cells['title'], 'Vandaag · saldo ontbreekt');
  assert.equal(sum(rel), cents(relative.lowestWith.eur));
});

test('Zonder verkoop: the bank today plus what is fixed, per kind, is the end without sales', () => {
  const committed = cashCommittedView(scenario, ctx);
  assert.equal(committed.id, 'cash.committed');
  assert.equal(sum(committed), cents(scenario.endBaseEur));
  assert.deepEqual(committed.total, { value: scenario.endBaseEur, format: 'eur', of: 'sum', label: 'Op 15 apr zonder verkoop' });
  assert.ok(committed.rows.every((row) => row.key === 'today' || scenario.items.find((item) => item.key === row.key)!.layer === 'BASE'), 'no scenario item');
  assert.deepEqual(committed.groups!.map((group) => group.label), ['Vandaag', 'Containers', 'Kosten', 'Btw', 'Klanten', 'Partners']);
  assert.ok(committed.rows.every((row) => committed.groups!.some((group) => group.key === row.group)));
  assert.equal(committed.summary, 'Onder nul op 25 jan');
  assert.equal(cashCommittedView({ ...base, zeroBase: null }, ctx).summary, 'Blijft boven nul');
  assert.equal(committed.columns.at(-1)!.key, committed.valueKey, 'with groups the value is the last column');
});

test('the scenario outcome per source: Σ margin = marginEur, Σ sales = salesExclEur, a container opens its sheet', () => {
  const sales = cashScenarioSalesView(scenario, ctx);
  assert.equal(sales.id, 'cash.scenarioSales');
  assert.equal(sum(sales), cents(scenario.scenario.marginEur));
  assert.equal(column(sales, 'sales'), cents(scenario.scenario.salesExclEur));
  assert.equal(column(sales, 'inBank'), cents(scenario.scenario.inHorizonEur));
  assert.equal(column(sales, 'sales') - column(sales, 'cost'), cents(scenario.scenario.marginEur));
  assert.deepEqual(sales.columns.filter((col) => col.sum).map((col) => col.key), ['sales', 'cost', 'inBank']);
  assert.equal(sales.rows.length, 1);
  assert.equal(sales.rows[0].cells['source'], 'PO-2026-043');
  opened.length = 0;
  (sales.rows[0].link as { run: () => void }).run();
  assert.deepEqual(opened, [43]);
  assert.deepEqual(sales.sort, { key: 'margin', dir: 'desc' });
  assert.equal(plain(sales.summary), '33,3 % marge op € 30.833 verkoop');
  const none = cashScenarioSalesView(base, ctx);
  assert.equal(none.rows.length, 0);
  assert.equal(none.empty, 'Geen scenarioverkoop tot 15 apr.');
});

test('the stock plan per product adds up to what the stock brings back', () => {
  const products = [
    { productId: 601, name: 'Rozendoos rond M', stockUnits: 120, externalUnitEur: 9.5, pricingUnitEur: 10.25, listUnitEur: 18, historicUnitEur: null, paceUnitsPerWeek: 8 },
    { productId: 602, name: 'Mini dome blush', stockUnits: 75, externalUnitEur: 6.1234, pricingUnitEur: null, listUnitEur: null, historicUnitEur: null, paceUnitsPerWeek: 3 },
    { productId: 603, name: 'Zonder stand', stockUnits: 0, externalUnitEur: 4, pricingUnitEur: null, listUnitEur: null, historicUnitEur: null, paceUnitsPerWeek: 0 },
  ];
  const forecast = buildCashForecast(exampleB({ products }), options({ scenario: true, includeStock: true }));
  const stock = forecast.scenario.sources.find((row) => row.id === 'stock')!;
  assert.equal(stock.products!.length, 2, 'products without stock are no plan line');
  const plan = cashStockPlanView(stock, ctx);
  assert.equal(plan.id, 'cash.stockPlan');
  assert.equal(sum(plan), cents(stock.backEur));
  assert.deepEqual(plan.total, { value: stock.backEur, format: 'eur', of: 'sum', label: 'Terug excl. btw' });
  assert.deepEqual(plan.rows.map((row) => row.link), [{ path: ['/products', 601] }, { path: ['/products', 602] }]);
  assert.deepEqual(plan.sort, { key: 'back', dir: 'desc' });
  /* Container sources carry no product list here (the container sheet has its own). */
  assert.ok(forecast.scenario.sources.filter((row) => row.id !== 'stock').every((row) => row.products === undefined));
});

test('a month of Per maand: the lines add up to its in + out; a receipt without a bank line is the named gap', () => {
  const receipt: ForecastMovement = { key: 'payment:900', lineId: null, account: K, atMs: Date.parse('2026-10-11T22:00:00Z'), day: '2026-10-12', amountEur: 750 };
  const input = exampleB({ movements: [...MOVEMENTS, receipt] });
  const forecast = buildCashForecast(input, options());
  const past = forecast.months.find((month) => month.key === '2026-10:past')!;
  const month = cashMonthView(past, view.monthLines(input, forecast, past), ctx);
  assert.equal(month.id, 'cash.month.2026-10:past');
  assert.equal(month.title, 'Gebeurd · 1–15 okt');
  assert.equal(month.total!.value, Math.round((past.inEur + past.outEur) * 100) / 100);
  assert.equal(month.gapLabel, 'Ontvangsten zonder banklijn');
  assert.equal(cents(month.total!.value) - sum(month), cents(750), 'the manual receipt is the gap');
  assert.deepEqual(month.rows.find((row) => row.key === 'line:103')!.link, { path: ['/costs'], query: { view: 'bank', tab: 'movements', line: 103 } });
  /* A future month: its items, no gap. */
  const december = forecast.months.find((row) => row.key === '2026-12')!;
  const future = cashMonthView(december, view.monthLines(input, forecast, december), ctx);
  assert.equal(sum(future), cents(future.total!.value));
  assert.equal(future.rows.length, december.count);
  assert.ok(sortedBy(future, 'day'));
  /* A scenario sale in a month opens its container's sheet on the screen. */
  const withSales = buildCashForecast(exampleC(), options({ scenario: true }));
  const march = withSales.months.find((row) => row.key === '2027-03')!;
  const sale = cashMonthView(march, view.monthLines(exampleC(), withSales, march), ctx).rows.find((row) => row.pill === 'Scenario' && String(row.cells['title']).includes('verkoop week'))!;
  assert.ok(sale && sale.link && 'run' in sale.link);
  opened.length = 0;
  (sale.link as { run: () => void }).run();
  assert.deepEqual(opened, [43]);
});

test('Lijkt al betaald: the matched items, the total is minus the reconciliation line', () => {
  const line = base.reconciliation.lines.find((row) => row.label.startsWith('Lijkt al betaald'))!;
  assert.ok(line, 'Example B has an unlinked deposit of PO-2026-043');
  const likely = cashLikelyPaidView(base, line.eur, ctx);
  assert.equal(likely.id, 'cash.likelyPaid');
  assert.equal(likely.rows.length, base.likelyPaid.length);
  assert.equal(likely.total!.value, -line.eur);
  assert.equal(sum(likely), cents(likely.total!.value), 'every match is a container term: no gap');
  assert.deepEqual(likely.rows[0].link, { path: ['/costs'], query: { view: 'bank', tab: 'movements', line: 103 } });
  assert.match(String(likely.rows[0].cells['bank']), /Yunnan Pubei/);
});

test('links: a container sale runs on the screen, other rows are routes, a stock sale leads nowhere', () => {
  opened.length = 0;
  const run = drillLinkOf({ path: [], query: null, po: 41 }, ctx) as { run: () => void };
  run.run();
  assert.deepEqual(opened, [41]);
  assert.deepEqual(drillLinkOf({ path: ['/costs'], query: { container: 43 }, po: null }, ctx), { path: ['/costs'], query: { container: 43 } });
  assert.equal(drillLinkOf(null, ctx), null);
});

test('the drill modules import types only (node-tested, no runtime import)', async () => {
  for (const file of ['drill-cash.ts', 'drill-market.ts']) {
    const text = await readFile(new URL(`../src/app/features/analyses/${file}`, import.meta.url), 'utf8');
    const imports = text.split('\n').filter((row) => /^import\b/.test(row));
    assert.ok(imports.length > 0 && imports.every((row) => row.startsWith('import type ')), `${file}: ${imports.join(' | ')}`);
  }
});
