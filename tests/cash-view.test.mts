import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import type { PartnerFinancing, PurchaseOrderForecast } from '../src/app/core/api/models.ts';
import { NO_DEFAULTS, buildCashForecast, horizonEndOf } from '../src/app/features/finance/cash-forecast.ts';
import type { CashForecastInput, ForecastAccount, ForecastBankLine, ForecastItem, ForecastMovement, ForecastOptions, ForecastOrder } from '../src/app/features/finance/cash-forecast.ts';
import { DEFAULT_CASH_LOCATION } from '../src/app/features/analyses/cash-url.ts';

/*
 * cash-view.ts imports cash-forecast and cash-format at runtime without an
 * extension: transpile it with those two imports pointed at their .ts files.
 */
const href = (path: string) => new URL(path, import.meta.url).href;
let source = await readFile(new URL('../src/app/features/analyses/cash-view.ts', import.meta.url), 'utf8');
source = source.replaceAll("'../finance/cash-forecast'", JSON.stringify(href('../src/app/features/finance/cash-forecast.ts')))
  .replaceAll("'../finance/cash-format'", JSON.stringify(href('../src/app/features/finance/cash-format.ts')));
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const view = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`) as typeof import('../src/app/features/analyses/cash-view.ts');

/** The texts keep amounts together with no-break spaces; compare them as plain text. */
const plain = (text: string | null | undefined) => (text ?? '').replaceAll(' ', ' ');

/* ------------------------------------------------------------------ Example B and C of the spec (as in cash-forecast.test.mts) */

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

/* ------------------------------------------------------------------ tests */

test('the 12-month markup keeps its basis when too thin to be the default (critique B4)', () => {
  assert.equal(view.realisedHint(-2.5, { invoices: 12, revenueEur: 90000, markupPct: -2.5 }), '12 mnd: -2,5 %', 'pct() as the hint always wrote it');
  assert.equal(view.realisedHint(null, { invoices: 1, revenueEur: 18846, markupPct: -2.5 }), '12 mnd: -2,5 % (1 factuur, te weinig om op te rekenen)');
  assert.equal(view.realisedHint(null, { invoices: 0, revenueEur: 0, markupPct: null }), '');
  assert.equal(view.standardMarkupNote(null, { invoices: 1, revenueEur: 18846, markupPct: -2.5 }), 'standaard: te weinig verkoophistoriek (1 factuur)');
  assert.equal(view.standardMarkupNote(30, { invoices: 5, revenueEur: 50000, markupPct: 30 }), '');
});

test('small texts: periods, signed whole euros, month names', () => {
  assert.equal(view.periodText('2026-12-01', '2026-12-13'), '1–13 dec');
  assert.equal(view.periodText('2027-01-08', '2027-03-04'), '8 jan–4 mrt');
  assert.equal(view.periodText('2027-01-28', '2027-01-28'), '28 jan');
  assert.equal(view.fromToText('2026-12-01', '2026-12-13'), 'van 1 tot 13 dec');
  assert.equal(view.fromToText('2027-01-08', '2027-03-04'), 'van 8 jan tot 4 mrt');
  assert.equal(view.signedWhole(82019.4), '+ € 82.019');
  assert.equal(view.signedWhole(-61007.2), '− € 61.007');
  assert.equal(view.signedWhole(0.2), '€ 0');
  assert.equal(view.monthName('2026-10', TODAY), 'Oktober');
  assert.equal(view.monthName('2027-01', TODAY), 'Januari ’27');
  assert.equal(view.keepAmounts('stand − € 7.173 op'), 'stand − € 7.173 op');
  assert.equal(view.marginOfMarkup(50), '33,3 %');
  assert.equal(view.pct(37.5), '37,5');
  assert.equal(view.threeMonthsBack('2026-10-15'), '2026-07-01');
  assert.equal(view.threeMonthsBack('2027-02-28'), '2026-11-01');
});

test('the krap banner: the first period with the scenario and its causes, the slow band, the relative mode', () => {
  /* The lowest stand and the day without sales are the figures under the banner (design C.7): the banner names the period and why. */
  assert.equal(plain(view.krapBanner(scenario)!.text), 'Krap van 8 jan tot 4 mrt, na Btw-aangifte Q4 2026 en Huur loods Wilrijk.');
  assert.deepEqual([view.krapBanner(scenario)!.kind, view.krapBanner(scenario)!.from, view.krapBanner(scenario)!.to], ['tight', '2027-01-08', '2027-03-04']);
  assert.equal(plain(view.phoneKrapBanner(scenario)!.text), 'Krap van 8 jan tot 4 mrt. Laagste stand − € 4.286 op ma 1 feb.');
  const slowOnly = { ...scenario, tightWith: [] };
  assert.equal(plain(view.krapBanner(slowOnly)!.text), 'Als de verkoop 4 weken trager loopt: krap van 8 jan tot 8 apr, laagste stand − € 5.824 op ma 1 mrt.');
  assert.equal(view.krapBanner({ ...scenario, tightWith: [], tightSlow: [] }), null);
  const relative = buildCashForecast(exampleB({ accounts: accounts({ currentEur: null, latestReading: null, checkedAt: null }) }), options());
  assert.equal(view.krapBanner(relative)!.text, 'Saldo ontbreekt voor KBC-zichtrekening: de prognose toont het verschil t.o.v. vandaag.');
  assert.deepEqual(view.chartBuffer(relative), { bufferEur: null, tight: [] });
  assert.deepEqual(view.chartBuffer(base), { bufferEur: 10000, tight: base.tightWith });
});

test('the five cards read the forecast', () => {
  const cards = Object.fromEntries(view.kpiCards(scenario).map((card) => [card.id, card]));
  assert.deepEqual([cards.bank.label, cards.bank.value, cards.bank.sub, cards.bank.foot, cards.bank.footWarn], ['Op de bank vandaag', '€ 32.365', 'KBC-zichtrekening € 32.365', 'Gecontroleerd 5 d geleden', false]);
  assert.deepEqual([cards.lowest.value, cards.lowest.sub, cards.lowest.foot, cards.lowest.valueTone], ['− € 4.286', 'ma 1 feb · met scenario', 'Onder buffer · 8 jan–4 mrt', 'danger']);
  assert.deepEqual([cards.end.label, cards.end.value, cards.end.foot], ['Op 15 apr', '€ 27.084', 'T.o.v. vandaag − € 5.282']);
  assert.deepEqual([cards.zero.label, cards.zero.value, cards.zero.sub, cards.zero.foot, cards.zero.kind, cards.zero.valueTone],
    ['Zonder verkoop', 'onder nul op 25 jan', 'zonder nieuwe verkoop', 'op 15 apr − € 7.450', 'text', 'danger']);
  assert.deepEqual([cards.scenario.value, cards.scenario.sub, cards.scenario.foot], ['+ € 34.533', 'tot 15 apr · incl. btw', 'Marge op goederen € 10.278 · 1 bron']);
  const stale = view.kpiCards({ ...scenario, startAccounts: [{ ...scenario.startAccounts[0], ageDays: 16, stale: true }] });
  assert.deepEqual([stale[0].foot, stale[0].footWarn], ['Saldo KBC-zichtrekening · 16 d oud', true]);
  const calm = view.kpiCards({ ...base, tightWith: [], zeroBase: null });
  assert.deepEqual([calm[1].foot, calm[3].value, calm[3].sub, calm[3].valueTone], ['Boven de buffer', 'blijft boven nul', 'zonder nieuwe verkoop', 'normal']);
  assert.equal(view.zeroText({ mode: 'relative', zeroBase: '2027-01-25' }), 'lager dan vandaag op 25 jan');
  assert.equal(view.zeroText({ mode: 'relative', zeroBase: null }), 'niet lager dan vandaag');
});

test('the chart: past line runs into today, markers and pins', () => {
  const series = view.forecastSeries(scenario, 14);
  assert.deepEqual(series.map((row) => [row.id, row.label, row.style, row.tone]), [
    ['past', 'Saldo: bank, daarna prognose met scenario', 'solid', 'accent'], ['with', 'Saldo: bank, daarna prognose met scenario', 'solid', 'accent'],
    ['base', 'Wat vastligt (zonder nieuwe verkoop)', 'dashed', 'muted'], ['slow', 'Verkoop 4 weken trager', 'dashed', 'warn']]);
  assert.equal(series[0].points.length, 15);
  assert.deepEqual(series[0].points.at(-1), { day: TODAY, eur: 32365.27 });
  assert.equal(series[0].points.at(-2)!.eur, 32365.27);
  assert.deepEqual(view.forecastMarkers(scenario).map((marker) => [marker.kind, marker.day, marker.label]), [
    ['lowest', '2027-02-01', 'Laagste − € 4.286 · ma 1 feb'], ['zero', '2027-01-25', 'Zonder verkoop onder nul · ma 25 jan'],
    ['end', '2027-04-15', '€ 27.084'], ['end', '2027-04-15', '− € 7.450 vastligt']]);
  assert.equal(view.forecastMarkers(base).filter((marker) => marker.kind === 'end').length, 1, 'without a scenario the two ends are one');
  assert.equal(view.forecastMarkers(scenario, false).length, 2);
  /* The phone's narrow chart: short labels that fit next to their points. */
  assert.deepEqual(view.forecastMarkers(scenario, false, true).map((marker) => marker.label), ['Laagste − € 4.286', 'Onder nul · 25 jan']);
  assert.deepEqual(view.pinLegend([{ n: 1, from: '2026-11-18', to: '2026-11-20', label: 'PO-2026-041 · Saldo bij aankomst', amountEur: -11008.4 }]),
    ['① PO-2026-041 · Saldo bij aankomst · 18–20 nov · − € 11.008']);
  assert.deepEqual(view.dayItems(base, '2026-12-01'), ['PO-2026-043 · 70% bij vertrek − € 21.000', 'PO-2026-044 · 2e voorschot + € 12.100', 'Huur loods Wilrijk − € 1.452']);
});

test('the month strip folds the current month together; lowest under the buffer is marked', () => {
  const strip = view.monthStrip(base);
  assert.deepEqual(strip.map((column) => column.label), ['okt', 'nov', 'dec', 'jan', 'feb', 'mrt', 'apr']);
  const past = base.months.find((month) => month.key === '2026-10:past')!;
  const future = base.months.find((month) => month.key === '2026-10')!;
  assert.equal(strip[0].inEur, Math.round((past.inEur + future.inEur) * 100) / 100);
  assert.equal(strip[0].outEur, Math.round((past.outEur + future.outEur) * 100) / 100);
  assert.deepEqual([strip[0].lowestEur, strip[0].lowestDay, strip[0].current, strip[0].endEur], [31000, '2026-10-13', true, 31788.77]);
  assert.deepEqual([strip[2].lowestEur, strip[2].lowWarn], [13829.41, false]);
  assert.deepEqual([strip[3].endEur, strip[3].lowWarn], [-2833.62, true]);
});

test('relative mode never marks a figure amber against the buffer (the figures are differences from today)', () => {
  const relative = buildCashForecast(exampleB({ accounts: accounts({ currentEur: null, latestReading: null, checkedAt: null }) }), options());
  assert.equal(relative.mode, 'relative');
  assert.ok(relative.months.some((month) => !month.past && month.lowestEur !== null && month.lowestEur < relative.bufferEur), 'the differences do fall under € 10.000');
  assert.ok(view.monthStrip(relative).every((column) => !column.lowWarn));
  assert.ok(view.registerGroups(relative, 'all', null).every((group) => !group.lowWarn));
  assert.equal(view.underBuffer(relative, 500), false);
  assert.equal(view.underBuffer(base, 9999.99), true);
  assert.equal(view.underBuffer(base, 10000), false);
  assert.equal(view.underBuffer(base, null), false);
  const cards = Object.fromEntries(view.kpiCards({ ...relative, lowestWith: { ...relative.lowestWith, eur: 500 } }).map((card) => [card.id, card]));
  assert.equal(cards.lowest.valueTone, 'normal');
});

test('the register: groups per month, filters, the summary line, CSV', () => {
  const counts = view.filterCounts(scenario);
  assert.equal(counts.all, scenario.register.filter((row) => row.kind === 'future').length);
  assert.equal(counts.scenario, 10 + 0, 'ten weeks of sales in the horizon');
  const groups = view.registerGroups(base, 'all', null);
  assert.deepEqual(groups.map((group) => group.label), ['Oktober', 'November', 'December', 'Januari ’27', 'Februari ’27', 'Maart ’27', 'April ’27']);
  assert.equal(groups.reduce((sum, group) => sum + group.rows.length, 0), counts.all - 10);
  /* The header says what the rows shown add up to; laagste and einde stay in the strip and Per maand (design D-K2). */
  assert.equal(view.groupSummary(groups[0]), '6 bewegingen · in € 8.141 · uit − € 8.718');
  assert.deepEqual(groups.map((group) => group.lowWarn), [false, false, false, true, true, true, true], 'laagste goes amber from January, under the buffer');
  const out = view.registerGroups(base, 'out', null);
  assert.ok(out.every((group) => group.rows.every((row) => row.amountEur < 0)));
  const containers = view.registerGroups(scenario, 'containers', null).flatMap((group) => group.rows);
  assert.ok(containers.length > 0 && containers.every((row) => row.item!.source.type === 'container'));
  const period = view.registerGroups(base, 'all', { from: '2026-12-01', to: '2026-12-14' }).flatMap((group) => group.rows);
  assert.deepEqual(period.map((row) => row.date), ['2026-12-01', '2026-12-01', '2026-12-01', '2026-12-14']);
  const csv = view.registerCsv([...base.register.filter((row) => row.kind === 'past').slice(0, 3), base.register.find((row) => row.kind === 'today')!]);
  const rows = csv.trimEnd().split('\r\n');
  assert.equal(rows[0], 'Datum;Omschrijving;Soort;Zekerheid;Regel;Bedrag;Saldo');
  assert.equal(rows.length, 4, 'three past rows and no line for the today divider');
  assert.equal(rows[1], '08/10/2026;Securex;Bank;Gebeurd;Bank · KBC-zichtrekening · Factuur september;-1500,00;38000,00');
  const future = view.registerCsv(base.register.filter((row) => row.key === 'cost:11'));
  assert.equal(future.split('\r\n')[1], '15/10/2026;Boekhouder Q3 · Fiduciaire Peeters;Kost;Verwacht;kostdatum 08/10 voorbij · nu;-665,50;' + future.split(';').at(-1)!.trim());
  assert.equal(view.phoneRowSub(base.register.find((row) => row.key === 'cost:11')!), 'do 15 okt · Kost · verwacht');
});

test('each row leads to its source', () => {
  const item = (source: ForecastItem['source'], kind: ForecastItem['kind'] = 'COST') => ({ ...base.items[0], source, kind });
  assert.deepEqual(view.itemLink(item({ type: 'cost', costId: 11 })), { path: ['/costs'], query: { cost: 11 }, po: null });
  assert.deepEqual(view.itemLink(item({ type: 'recurring', recurringId: 3 })), { path: ['/costs'], query: { view: 'costs', tab: 'recurring' }, po: null });
  assert.deepEqual(view.itemLink(item({ type: 'container', orderId: 43 }, 'SUPPLIER')), { path: ['/costs'], query: { container: 43 }, po: null });
  assert.deepEqual(view.itemLink(item({ type: 'container', orderId: 43 }, 'SALES')), { path: [], query: null, po: 43 });
  assert.deepEqual(view.itemLink(item({ type: 'invoice', salesOrderId: 420 })), { path: ['/sales', 420], query: null, po: null });
  assert.deepEqual(view.itemLink(item({ type: 'quote', salesOrderId: 390 })), { path: ['/sales', 390], query: null, po: null });
  assert.deepEqual(view.itemLink(item({ type: 'vat', year: 2026, quarter: 4 })), { path: ['/costs'], query: { view: 'analysis', tab: 'vat', year: 2026, quarter: 4 }, po: null });
  assert.deepEqual(view.itemLink(item({ type: 'advance', orderId: 44, rowId: 7 })), { path: ['/purchasing', 44], query: { section: 'payments' }, po: null });
  assert.equal(view.itemLink(item({ type: 'stock' }, 'SALES')), null);
  assert.deepEqual(view.lineLink(103), { path: ['/costs'], query: { view: 'bank', tab: 'movements', line: 103 }, po: null });
});

test('data quality, rule switches and the reconciliation note', () => {
  const input = exampleB({ accounts: accounts({ checkedAt: '2026-09-20T10:00:00Z' }),
    openCosts: [...exampleB().openCosts, { costId: 13, title: 'Verzekering', party: 'AG', date: '2026-10-01', dueDate: null, openEur: 1200 }] });
  const forecast = buildCashForecast(input, options());
  assert.deepEqual(view.dataQuality(input, forecast).map((line) => [line.text, line.action, line.po]), [
    ['KBC-zichtrekening: saldo 25 d niet gecontroleerd.', 'Controleren', null],
    ['1 banktransactie nog te koppelen.', 'Koppelen', null],
    ['PO-2026-043: vertrek geschat (aankomst 08/01 − 38 d transit).', 'Datum', 43],
    ['1 open kost zonder vervaldag.', 'Bekijken', null],
  ]);
  assert.deepEqual(view.dataQuality({ ...input, ticaVatIncomplete: true }, forecast)[0].link, { path: ['/tica'], query: { tab: 'afrekeningen' }, po: null },
    'Afrekeningen controleren opens the Afrekeningen tab, not today\'s sales');
  assert.deepEqual(view.unlinkedLines(exampleB()), { count: 1, eur: -9000 });
  const switches = view.ruleSwitches(base, { ...DEFAULT_CASH_LOCATION, rulesOff: ['vat'] }, 40);
  assert.deepEqual(switches.map((row) => [row.rule, row.on]), [['invoices', true], ['tica', true], ['quotes', true], ['openQuotes', false], ['partner', true], ['containers', true], ['costs', true], ['vat', false]]);
  assert.equal(switches[3].sub, 'waarde × 40 % conversie (12 mnd)');
  assert.equal(switches[0].totalEur, base.ruleTotals.invoices);
  /* Seven rules besides the open quotes, which the sentence names once (design D-K8). */
  assert.equal(view.ruleSummary(switches), '6 van 7 regels aan · open offertes uit');
  assert.equal(view.ruleSummary(view.ruleSwitches(base, DEFAULT_CASH_LOCATION, 40)), '7 van 7 regels aan · open offertes uit');
  assert.equal(view.ruleSummary(view.ruleSwitches(base, { ...DEFAULT_CASH_LOCATION, openQuotesOn: true }, 40)), '7 van 7 regels aan · open offertes aan');
  /* The note under Per maand is the link to what is still to link; the rest is in "Hoe gerekend" (design C.7). */
  assert.equal(plain(view.monthTableNote(exampleB(), base)), '1 nog te koppelen (− € 9.000)');
  assert.equal(view.monthTableNote(exampleB({ bankLines: BANK_LINES.map((row) => ({ ...row, allocated: true })) }), base), '');
  /* Its link opens the list it counts: the same days (the first past month shown up to today) on the one counted account. */
  const pastStart = base.months.find((month) => month.past)!.key.slice(0, 7);
  assert.deepEqual(view.monthTableNoteQuery(exampleB(), base),
    { view: 'bank', tab: 'movements', link: 'unlinked', from: `${pastStart}-01`, to: TODAY, account: K });
  const two = exampleB({ accounts: [...accounts(), { ...accounts()[0], key: 'BE00', label: 'Spaarrekening' }] });
  assert.equal(view.monthTableNoteQuery(two, base)['account'], undefined, 'two counted accounts: the list keeps every account');
});

test('Per maand: rows, cells and the lines behind a month', () => {
  const table = view.monthTable(base);
  assert.deepEqual(table.rows.map((row) => row.label), ['Begin', 'Containers · uit', 'Verkoop containers (scenario)', 'Klanten en voorraad', 'Btw', 'Kosten', 'Einde', 'Laagste']);
  assert.equal(table.months.length, base.months.length);
  assert.equal(view.tableCell(0), '—');
  assert.equal(view.tableCell(null), '—');
  assert.equal(view.tableCell(-2833.62), '− € 2.834');
  const withOther = view.monthTable({ ...base, months: base.months.map((month, index) => (index === 0 ? { ...month, otherEur: 300 } : month)) });
  assert.ok(withOther.rows.some((row) => row.label === 'Andere'));
  const october = base.months.find((month) => month.key === '2026-10:past')!;
  assert.deepEqual(view.monthLines(exampleB(), base, october).map((row) => [row.day, row.title, row.amountEur]), [
    ['2026-10-08', 'Securex', -1500], ['2026-10-09', 'Bloomstore GmbH', 2000], ['2026-10-13', 'Yunnan Pubei Flowers Co., Ltd', -9000],
    ['2026-10-14', 'Bloemenatelier Lies BV', 1452], ['2026-10-14', 'Proximus', -86.73]]);
  assert.match(view.monthLines(exampleB(), base, october)[2].sub, /Te koppelen$/);
  const december = base.months.find((month) => month.key === '2026-12')!;
  assert.equal(view.monthLines(exampleB(), base, december).length, december.count);
});

test('the scenario outcome, the order-date sentence and the container texts', () => {
  const outcome = view.scenarioOutcome(scenario);
  assert.deepEqual(outcome, { salesExclEur: 30833.36, salesVatEur: 3700, inHorizonEur: 34533.36, vatRows: [], vatEur: 0, vatNote: 'na 15 apr', marginEur: 10277.76, marginPct: 33.3,
    afterHorizonEur: 27626.64 });
  /* A scenario VAT row that lowers a return (a concept's import VAT outweighs the sales VAT) adds, it is never paid. */
  const vatItem = (amountEur: number, year: number, quarter: number, date: string): ForecastItem => ({ ...scenario.items[0], key: `vat:${year}-Q${quarter}:scenario`,
    layer: 'SCENARIO', rule: null, kind: 'VAT', certainty: 'SCENARIO', date, amountEur, source: { type: 'vat', year, quarter } });
  const signed = view.scenarioOutcome({ ...scenario, items: [...scenario.items, vatItem(3200, 2026, 4, '2027-01-25'), vatItem(-1500.4, 2027, 1, '2027-04-15')] });
  assert.deepEqual(signed.vatRows, [{ label: 'Btw minder af te dragen (aangifte Q4, 25 jan)', op: '+', eur: 3200 }, { label: 'Btw afgedragen (aangifte Q1, 15 apr)', op: '−', eur: 1500.4 }]);
  assert.equal(signed.vatEur, 1699.6);
  assert.equal(signed.vatNote, null);
  assert.equal(plain(view.suggestionText({ orderId: 45, currentDate: '2026-11-02', currentLowestEur: 0, currentLowestDay: '2026-12-07', suggestedDate: '2026-11-16', rule: 'buffer' }, 'PO-2026-045')),
    'Bestel je PO-2026-045 op 2 nov, dan sta je op ma 7 dec op € 0. Vanaf ma 16 nov blijft je laagste stand boven de buffer.');
  assert.match(view.suggestionText({ orderId: 45, currentDate: '2026-11-02', currentLowestEur: -5, currentLowestDay: '2026-12-07', suggestedDate: '2026-11-16', rule: 'lowest' }, 'PO-2026-045'),
    /wordt je laagste stand niet lager dan nu\.$/);
  assert.equal(plain(view.likelyPaidText({ account: 'KBC-zichtrekening', day: '2026-10-13', amountEur: -9000, reference: 'PO-2026-043 DEPOSIT 30PCT' })),
    'Lijkt al betaald: KBC-zichtrekening 13/10 · − € 9.000,00 · “PO-2026-043 DEPOSIT 30PCT”. Nog niet gekoppeld; de prognose rekent hem als betaald.');
  assert.equal(view.peakMonth([0.8, 2.4, 0.8, 0.8, 1.6, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8]), 'februari');
  assert.equal(view.peakMonth(null), null);
});

test('a typed buffer: Dutch thousands and decimals, nothing for an empty field', () => {
  assert.equal(view.parseAmount('12.500'), 12500);
  assert.equal(view.parseAmount('12.250'), 12250);
  assert.equal(view.parseAmount('7999'), 7999);
  assert.equal(view.parseAmount('12.500,50'), 12500.5);
  assert.equal(view.parseAmount('12500,5'), 12500.5);
  assert.equal(view.parseAmount('12500.50'), 12500.5);
  assert.equal(view.parseAmount('1.234.567'), 1234567);
  assert.equal(view.parseAmount(' € 10.000 '), 10000);
  assert.equal(view.parseAmount('0'), 0);
  assert.equal(view.parseAmount('12.5'), 12.5);
  for (const text of ['', '   ', 'abc', '-500', '1,2,3', '1.234.56', '€']) assert.equal(view.parseAmount(text), null, text);
  assert.equal(view.amountText(10000), '10.000');
  assert.equal(view.amountText(12500.5), '12.500,50');
  assert.equal(view.parseAmount(view.amountText(12500.5)), 12500.5);
});

test('the full write of one order keeps what is stored and takes the change', () => {
  const stored: PurchaseOrderForecast = { ...notIncluded, orderId: 43, included: null, markupPct: 60, expectedShipOn: '2026-12-01', updatedAt: '2026-10-15T10:00:00Z', actor: 'Emre' };
  assert.deepEqual(view.forecastWrite(stored, { sellWeeks: 14 }), { priceMode: null, markupPct: 60, markupEurPerUnit: null, costBasis: null, sellWeeks: 14, paymentDays: null,
    seasonal: null, included: null, expectedShipOn: '2026-12-01', orderDateOverride: null });
  assert.deepEqual(view.forecastWrite(null, { included: false }), { priceMode: null, markupPct: null, markupEurPerUnit: null, costBasis: null, sellWeeks: null,
    paymentDays: null, seasonal: null, included: false, expectedShipOn: null, orderDateOverride: null });
  assert.equal(view.forecastWrite(stored, { expectedShipOn: null }).expectedShipOn, null, 'a cleared value is sent as null');
  assert.equal(view.adjusted(stored), true);
  assert.equal(view.adjusted(view.forecastWrite(null, {})), false);
  assert.equal(view.adjusted(null), false);
});

test('advance schedules load only for financings that still invoice advances', () => {
  const financing = (purchaseOrderId: number, extra: Partial<PartnerFinancing>) => ({ purchaseOrderId, settlementInvoiceId: null, unbilledAdvanceCount: 0, documents: [], ...extra }) as PartnerFinancing;
  assert.deepEqual(view.financingsWithSchedule([
    financing(44, { unbilledAdvanceCount: 1 }),
    financing(45, { documents: [{ id: 1, number: 'VF1', purpose: 'PARTNER_ADVANCE', docType: 'FACTUUR', status: 'CONCEPT', invoiceTotalEur: 1, receivedEur: 0, remainingEur: 1, creditEur: 0 }] }),
    financing(46, { unbilledAdvanceCount: 2, settlementInvoiceId: 9 }),
    financing(47, {}),
  ]), [44, 45]);
});

test('bankTextShort drops IBAN, BIC, "KBC Mobile" and card numbers; the counterparty and free text stay', () => {
  const raw = 'Bloemen Lotus BV   BE68 5390 0754 7034  GKCCBEBB  KBC Mobile  Betaling factuur F2026-0138 4871 XXXX XXXX 1234';
  assert.equal(view.bankTextShort(raw), 'Bloemen Lotus BV Betaling factuur F2026-0138');
  assert.equal(view.bankTextShort('BETALING VIA KBC-Mobile aan NL91ABNA0417164300 ABNANL2A Kwekerij'), 'BETALING VIA aan Kwekerij', 'an uppercase word like BETALING is no BIC');
  assert.equal(view.bankTextShort(''), '');
  assert.equal(view.bankTextShort(null), '');
});

test('the first forecast waits for this round\'s advance schedules only when there are some (critique N13)', () => {
  assert.equal(view.forecastReady(2, -1, true), false, 'schedules of round 2 not in yet');
  assert.equal(view.forecastReady(2, 1, true), false, 'last round\'s schedules do not count');
  assert.equal(view.forecastReady(2, 2, true), true);
  assert.equal(view.forecastReady(2, -1, false), true, 'no financing with a schedule, or the financings failed: nothing to wait for');
});
