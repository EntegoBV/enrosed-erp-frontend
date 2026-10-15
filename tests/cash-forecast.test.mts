import assert from 'node:assert/strict';
import test from 'node:test';
import type { PurchaseOrderForecast } from '../src/app/core/api/models.ts';
import {
  CERTAINTY_LABEL, NO_DEFAULTS, balanceHistory, buildCashForecast, dayEndBalances, defaultSellWeeks, distributeCents, horizonEndOf,
  likelyPaid, parsePaymentTerms, poSheet, resolveChoice, runningBalances, seasonalProfile, suggestOrderDate,
} from '../src/app/features/finance/cash-forecast.ts';
import type {
  CashForecast, CashForecastInput, ForecastAccount, ForecastBankLine, ForecastItem, ForecastMovement, ForecastOptions, ForecastOrder,
} from '../src/app/features/finance/cash-forecast.ts';

/* ------------------------------------------------------------------ Example A: accounts and movements (spec §2.3) */

const TODAY = '2026-10-15';
const K = 'BE94731074082814';
const W = 'WISE EUR';
const K_READING = Date.parse('2026-10-10T21:59:59.999Z');
const W_READING = Date.parse('2026-10-01T08:00:00Z');

function accounts(overrides: { k?: Partial<ForecastAccount>; w?: Partial<ForecastAccount> } = {}): ForecastAccount[] {
  return [
    { key: K, label: 'KBC-zichtrekening', source: 'ODOO', archived: false, countsInCash: true, currentEur: 32365.27,
      checkedAt: new Date(K_READING).toISOString(), firstReadingAtMs: K_READING, latestReading: { atMs: K_READING, balanceEur: 40000 }, labelOnly: false, ...overrides.k },
    { key: W, label: 'Wise EUR', source: 'MANUAL', archived: false, countsInCash: false, currentEur: 5300,
      checkedAt: new Date(W_READING).toISOString(), firstReadingAtMs: W_READING, latestReading: { atMs: W_READING, balanceEur: 5000 }, labelOnly: false, ...overrides.w },
  ];
}

const move = (id: number, account: string, at: string, day: string, amountEur: number): ForecastMovement =>
  ({ key: `bank:${id}`, lineId: id, account, atMs: Date.parse(at), day, amountEur });

const MOVEMENTS: ForecastMovement[] = [
  move(201, W, '2026-09-28T10:00:00Z', '2026-09-28', -200),
  move(202, W, '2026-10-05T09:00:00Z', '2026-10-05', 300),
  move(101, K, '2026-10-07T22:00:00Z', '2026-10-08', -1500),
  move(102, K, '2026-10-08T22:00:00Z', '2026-10-09', 2000),
  move(103, K, '2026-10-12T22:00:00Z', '2026-10-13', -9000),
  move(104, K, '2026-10-13T22:00:00Z', '2026-10-14', 1452),
  move(105, K, '2026-10-13T22:00:00Z', '2026-10-14', -86.73),
];

const bankLine = (id: number, account: string, day: string, amountEur: number, counterparty: string, reference: string,
  kind: ForecastBankLine['parts'][number]['kind'], allocated = true, extra: Partial<ForecastBankLine> = {}): ForecastBankLine => ({
  id, account, day, amountEur, counterparty, reference, allocated, official: true, classification: null, transferLineId: null,
  parts: [{ kind, amountEur }], accountLabel: account === K ? 'KBC-zichtrekening' : 'Wise EUR', ...extra,
});

const BANK_LINES: ForecastBankLine[] = [
  bankLine(201, W, '2026-09-28', -200, 'Alibaba.com', 'samples', 'COSTS'),
  bankLine(202, W, '2026-10-05', 300, 'Topup', 'Topup', 'OTHER'),
  bankLine(101, K, '2026-10-08', -1500, 'Securex', 'Factuur september', 'COSTS'),
  bankLine(102, K, '2026-10-09', 2000, 'Bloomstore GmbH', 'RE F2026-0376', 'CUSTOMERS'),
  bankLine(103, K, '2026-10-13', -9000, 'Yunnan Pubei Flowers Co., Ltd', 'PO-2026-043 DEPOSIT 30PCT', 'COSTS', false),
  bankLine(104, K, '2026-10-14', 1452, 'Bloemenatelier Lies BV', '+++412/0412/66087+++', 'CUSTOMERS'),
  bankLine(105, K, '2026-10-14', -86.73, 'Proximus', 'Domiciliëring 6201554718', 'COSTS'),
];

test('Example A: running balances walk the reading forward and back; a manual account is unknown before its first reading', () => {
  const running = runningBalances(MOVEMENTS, accounts());
  const row = (id: number) => running.get(`bank:${id}`)!;
  assert.deepEqual(row(201), { accountAfterEur: null, totalAfterEur: null, unknownBefore: '2026-10-01' });
  assert.deepEqual(row(202), { accountAfterEur: 5300, totalAfterEur: 44800, unknownBefore: null });
  assert.deepEqual(row(101), { accountAfterEur: 38000, totalAfterEur: 43300, unknownBefore: null });
  assert.deepEqual(row(102), { accountAfterEur: 40000, totalAfterEur: 45300, unknownBefore: null });
  assert.deepEqual(row(103), { accountAfterEur: 31000, totalAfterEur: 36300, unknownBefore: null });
  assert.deepEqual(row(104), { accountAfterEur: 32452, totalAfterEur: 37752, unknownBefore: null });
  assert.deepEqual(row(105), { accountAfterEur: 32365.27, totalAfterEur: 37665.27, unknownBefore: null });
});

test('Example A: day ends per account and the counted balance history', () => {
  const ends = dayEndBalances(MOVEMENTS, accounts(), [K], '2026-10-07', '2026-10-14');
  assert.equal(ends.get('2026-10-07'), 39500);
  assert.equal(ends.get('2026-10-08'), 38000);
  assert.equal(ends.get('2026-10-09'), 40000);
  assert.equal(ends.get('2026-10-13'), 31000);
  assert.equal(ends.get('2026-10-14'), 32365.27);
  const history = balanceHistory(MOVEMENTS, accounts(), '2026-09-30', '2026-10-14');
  assert.equal(history.find((row) => row.day === '2026-10-14')!.eur, 32365.27);
  assert.equal(history.find((row) => row.day === '2026-09-30')!.eur, 39500);
  /* W: unknown before its first reading (end of 30/09), known from that day on (the reading itself, before 202). */
  const wise = dayEndBalances(MOVEMENTS, accounts(), [W], '2026-09-30', '2026-10-05');
  assert.equal(wise.get('2026-09-30'), null);
  assert.equal(wise.get('2026-10-01'), 5000);
  assert.equal(wise.get('2026-10-05'), 5300);
});

test('Example A with statementsFrom 2026-10-01: older movements are no movements, the opening is before the first kept one', () => {
  const kept = MOVEMENTS.filter((row) => row.day >= '2026-10-01');
  const running = runningBalances(kept, accounts(), '2026-10-01');
  assert.equal(running.has('bank:201'), false);
  assert.equal(running.get('bank:202')!.totalAfterEur, 44800);
  /* Handed the untruncated list, the function truncates the same way. */
  assert.equal(runningBalances(MOVEMENTS, accounts(), '2026-10-01').get('bank:202')!.totalAfterEur, 44800);
  const history = balanceHistory(kept, accounts(), '2026-09-30', '2026-10-14', '2026-10-01');
  assert.equal(history.find((row) => row.day === '2026-09-30')!.eur, null);
  assert.equal(history.find((row) => row.day === '2026-10-01')!.eur, 39500);
  assert.equal(history.find((row) => row.day === '2026-10-14')!.eur, 32365.27);
});

test('an account with a reading and no movements adds its reading (Odoo at every instant, manual from its first reading)', () => {
  const savings: ForecastAccount = { key: 'BE11', label: 'Spaar', source: 'ODOO', archived: false, countsInCash: true, currentEur: 1000,
    checkedAt: '2026-10-12T10:00:00Z', firstReadingAtMs: Date.parse('2026-10-12T10:00:00Z'), latestReading: { atMs: Date.parse('2026-10-12T10:00:00Z'), balanceEur: 1000 }, labelOnly: false };
  const cash: ForecastAccount = { ...savings, key: 'KAS', label: 'Kas', source: 'MANUAL' };
  const both = [...accounts(), savings, cash];
  const running = runningBalances(MOVEMENTS, both);
  /* 101 is on 08/10: the Odoo savings account counts, the manual cash box is not known yet → the total is unknown. */
  assert.equal(running.get('bank:101')!.totalAfterEur, null);
  const withoutCash = runningBalances(MOVEMENTS, [...accounts(), savings]);
  assert.equal(withoutCash.get('bank:101')!.totalAfterEur, 44300);
  const ends = dayEndBalances(MOVEMENTS, both, ['BE11', 'KAS'], '2026-10-11', '2026-10-13');
  assert.equal(ends.get('2026-10-11'), null);
  assert.equal(ends.get('2026-10-12'), 2000);
  assert.equal(ends.get('2026-10-13'), 2000);
});

/* ------------------------------------------------------------------ Example B: the base forecast (spec §2.13) */

function order43(extra: Partial<ForecastOrder> = {}): ForecastOrder {
  return { orderId: 43, number: 'PO-2026-043', alias: null, status: 'BESTELD', partner: false, archived: false, supplierName: 'Yunnan Pubei Flowers Co., Ltd',
    orderDate: '2026-10-10', shippedOn: null, expectedArrival: '2027-01-08', receivedOn: null, leadTimeDays: 35, transitDays: 38,
    importVatEur: 7140, importVatCovered: false, clearance: 'BE_CUSTOMS', clearanceConfirmed: true, paidEur: 0, remainingEur: 37000,
    internalMarkupEur: 2500, lines: [], payments: [], ...extra };
}
function order41(extra: Partial<ForecastOrder> = {}): ForecastOrder {
  return { orderId: 41, number: 'PO-2026-041', alias: null, status: 'ONDERWEG', partner: false, archived: false, supplierName: 'Ningbo Florals',
    orderDate: '2026-08-20', shippedOn: '2026-10-02', expectedArrival: '2026-11-18', receivedOn: null, leadTimeDays: 35, transitDays: 38,
    importVatEur: 3000, importVatCovered: false, clearance: 'NL_FISCAL_REP_TO_BE', clearanceConfirmed: true, paidEur: 20000, remainingEur: 11008.4,
    internalMarkupEur: 900, lines: [], payments: [], ...extra };
}

const monthly = (id: number, name: string, party: string, amountInclEur: number, day: number, autoPaid: boolean) =>
  Array.from({ length: 13 }, (_, index) => {
    const month = 10 + index; // nov 2026 = index 0
    const year = 2026 + Math.floor(month / 12);
    const date = `${year}-${String((month % 12) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { recurringId: id, name, party, date, amountInclEur, autoPaid, intervalLabel: 'Maandelijks' };
  });

function exampleB(extra: Partial<CashForecastInput> = {}): CashForecastInput {
  return {
    today: TODAY, statementsFrom: null, accounts: accounts(), movements: MOVEMENTS, bankLines: BANK_LINES,
    openCosts: [
      { costId: 11, title: 'Boekhouder Q3', party: 'Fiduciaire Peeters', date: '2026-10-08', dueDate: null, openEur: 665.5 },
      { costId: 12, title: 'Brochures beurs', party: 'Vandersanden Drukwerk', date: '2026-10-13', dueDate: '2026-11-05', openEur: 423.5 },
    ],
    recurring: [...monthly(3, 'Huur loods Wilrijk', 'Immo Wilrijk', 1452, 1, false), ...monthly(4, 'Proximus', 'Proximus', 86.73, 14, true)],
    containerRows: [
      { key: 'container:43:SUPPLIER:ORDERED', orderId: 43, payee: 'SUPPLIER', due: 'ORDERED', termLabel: '30% bij bestelling', remainingEur: 9000, concept: false },
      { key: 'container:43:SUPPLIER:SHIPPED', orderId: 43, payee: 'SUPPLIER', due: 'SHIPPED', termLabel: '70% bij vertrek', remainingEur: 21000, concept: false },
      { key: 'container:43:LOGISTICS', orderId: 43, payee: 'LOGISTICS', due: null, termLabel: null, remainingEur: 6400, concept: false },
      { key: 'container:43:SEPARATE', orderId: 43, payee: 'SEPARATE', due: null, termLabel: null, remainingEur: 600, concept: false },
      { key: 'container:41:SUPPLIER:ARRIVED', orderId: 41, payee: 'SUPPLIER', due: 'ARRIVED', termLabel: 'Saldo bij aankomst', remainingEur: 8690, concept: false },
      { key: 'container:41:LOGISTICS', orderId: 41, payee: 'LOGISTICS', due: null, termLabel: null, remainingEur: 2318.4, concept: false },
    ],
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
    openQuotes: [],
    vatQuarters: [{ year: 2026, quarter: 3, knownNetEur: -7412 }, { year: 2026, quarter: 4, knownNetEur: -2184.3 }],
    paidVatPeriods: [], importVatDeferred: false, products: [],
    history: { realisedMarkupPct: 50, paymentDays: 21, vatPct: 12, seasonal: null, openQuoteConversionPct: 0 },
    stored: [], bufferEur: 10000,
    outlook: { bankEur: 37665.27, expectedEur: 580.14, netOpenEur: -37085.13, upcoming30Eur: 1538.73 },
    ...extra,
  };
}

function options(extra: Partial<ForecastOptions> = {}): ForecastOptions {
  return { horizonEnd: horizonEndOf(TODAY, 6), scenario: false, includeStock: false, rulesOff: [], openQuotesOn: false, defaults: NO_DEFAULTS,
    dismissed: [], pastDays: 42, ...extra };
}

const row = (item: ForecastItem) => [item.date, item.amountEur, item.key, `${CERTAINTY_LABEL[item.certainty]} · ${item.ruleText}`];
const lines = (forecast: CashForecast) => Object.fromEntries(forecast.reconciliation.lines.map((line) => [line.label, line.eur]));

test('horizonEndOf keeps the day, or takes the last day of a shorter month', () => {
  assert.equal(horizonEndOf('2026-10-15', 6), '2027-04-15');
  assert.equal(horizonEndOf('2026-08-31', 6), '2027-02-28');
});

test('Example B: every base item on its day with its certainty and rule text', () => {
  const forecast = buildCashForecast(exampleB(), options());
  assert.equal(forecast.mode, 'absolute');
  assert.equal(forecast.startEur, 32365.27);
  assert.deepEqual(forecast.excludedAccounts, [{ key: W, label: 'Wise EUR', eur: 5300 }]);
  const items = forecast.items.map(row);
  const expected = [
    ['2026-10-15', 2000, 'invoice:300', 'Verwacht · vervallen 20/05 · nu'],
    ['2026-10-15', -640, 'credit', 'Vast · tegoed af te handelen'],
    ['2026-10-15', -665.5, 'cost:11', 'Verwacht · kostdatum 08/10 voorbij · nu'],
    ['2026-10-16', 1906, 'invoice:405', 'Geschat · vervallen 02/10 · betaalt meestal 14 d later'],
    ['2026-10-21', 4235, 'invoice:420', 'Vast · vervaldag 21/10'],
    ['2026-10-25', -7412, 'vat:2026-Q3', 'Vast · aangifte Q3 2026 · vóór 25/10'],
    ['2026-11-01', -1452, 'recurring:3:2026-11-01', 'Vast · vaste kost · maandelijks'],
    ['2026-11-05', 6050, 'invoice:521', 'Vast · vervaldag 05/11'],
    ['2026-11-05', -423.5, 'cost:12', 'Vast · vervaldag 05/11'],
    ['2026-11-14', -86.73, 'recurring:4:2026-11-14', 'Vast · vaste kost · maandelijks · domiciliëring'],
    ['2026-11-18', -8690, 'container:41:SUPPLIER:ARRIVED', 'Verwacht · bij aankomst · ETA 18/11'],
    ['2026-11-20', -2318.4, 'container:41:LOGISTICS', 'Verwacht · aankomst 18/11 + 2 d'],
    ['2026-11-24', -600, 'container:43:SEPARATE', 'Geschat · vertrek 01/12 − 7 d (inspectie)'],
    ['2026-12-01', 12100, 'advance:44:7', 'Vast · voorschotschema · vervalt 01/12'],
    ['2026-12-01', -1452, 'recurring:3:2026-12-01', 'Vast · vaste kost · maandelijks'],
    ['2026-12-01', -21000, 'container:43:SUPPLIER:SHIPPED', 'Geschat · bij vertrek · aankomst 08/01 − 38 d transit'],
    ['2026-12-14', -86.73, 'recurring:4:2026-12-14', 'Vast · vaste kost · maandelijks · domiciliëring'],
    ['2026-12-16', 3267, 'quote:390', 'Geschat · leverweek 47 + 30 dagen netto'],
    ['2027-01-01', -1452, 'recurring:3:2027-01-01', 'Vast · vaste kost · maandelijks'],
    ['2027-01-08', -7140, 'importvat:43', 'Verwacht · btw bij invoer · inklaring België · ETA 08/01'],
    ['2027-01-10', -6400, 'container:43:LOGISTICS', 'Verwacht · aankomst 08/01 + 2 d'],
    ['2027-01-14', -86.73, 'recurring:4:2027-01-14', 'Vast · vaste kost · maandelijks · domiciliëring'],
    ['2027-01-25', -4851.3, 'vat:2026-Q4', 'Geschat · aangifte Q4 2026 · tot nu + geschat · vóór 25/01'],
    ['2027-02-01', -1452, 'recurring:3:2027-02-01', 'Vast · vaste kost · maandelijks'],
    ['2027-02-14', -86.73, 'recurring:4:2027-02-14', 'Vast · vaste kost · maandelijks · domiciliëring'],
    ['2027-03-01', -1452, 'recurring:3:2027-03-01', 'Vast · vaste kost · maandelijks'],
    ['2027-03-14', -86.73, 'recurring:4:2027-03-14', 'Vast · vaste kost · maandelijks · domiciliëring'],
    ['2027-04-01', -1452, 'recurring:3:2027-04-01', 'Vast · vaste kost · maandelijks'],
    ['2027-04-14', -86.73, 'recurring:4:2027-04-14', 'Vast · vaste kost · maandelijks · domiciliëring'],
  ];
  assert.deepEqual(items, expected);
  const byKey = new Map(forecast.items.map((item) => [item.key, item]));
  assert.equal(byKey.get('invoice:300')!.overdue, true);
  assert.equal(byKey.get('invoice:300')!.originalDate, '2026-05-20');
  assert.equal(byKey.get('container:43:SUPPLIER:SHIPPED')!.title, 'PO-2026-043 · 70% bij vertrek');
  assert.equal(byKey.get('invoice:521')!.title, 'Voorschotfactuur VF2026-0021');
  assert.equal(byKey.get('invoice:521')!.kind, 'PARTNER');
  assert.equal(byKey.get('importvat:43')!.deductibleVatEur, 7140);
  assert.equal(byKey.get('advance:44:7')!.vatDate, '2026-12-01');
  assert.equal(byKey.get('quote:390')!.vatDate, '2026-11-16');
  /* The deposit is on the bank already: one likely-paid match, by its reference. */
  assert.deepEqual(forecast.likelyPaid, [{ lineId: 103, itemKey: 'container:43:SUPPLIER:ORDERED', orderId: 43, title: 'PO-2026-043 · 30% bij bestelling',
    amountEur: -9000, day: '2026-10-13', account: 'KBC-zichtrekening', counterparty: 'Yunnan Pubei Flowers Co., Ltd',
    reference: 'PO-2026-043 DEPOSIT 30PCT', reason: 'reference' }]);
  assert.deepEqual(forecast.excludedItems.map((item) => item.key), ['container:43:SUPPLIER:ORDERED']);
});

test('Example B: end, lowest, zero crossing and the krap period', () => {
  const forecast = buildCashForecast(exampleB(), options());
  assert.equal(forecast.endBaseEur, -7449.81);
  assert.deepEqual(forecast.lowestBase, { day: '2027-04-14', eur: -7449.81, causes: ['Huur loods Wilrijk', 'Proximus'] });
  assert.equal(forecast.zeroBase, '2027-01-25');
  assert.deepEqual(forecast.days[0], { day: TODAY, baseEur: 33059.77, withEur: 33059.77, slowEur: 33059.77, inEur: 2000, outEur: -1305.5 });
  assert.equal(forecast.days[forecast.days.length - 1].day, '2027-04-15');
  assert.equal(forecast.tightWith.length, 1);
  assert.equal(forecast.tightWith[0].from, '2027-01-08');
  assert.equal(forecast.tightWith[0].to, '2027-04-15');
  /* Without a scenario, with and slow are the base. */
  assert.equal(forecast.endWithEur, forecast.endBaseEur);
  assert.deepEqual(forecast.lowestWith, forecast.lowestBase);
  assert.deepEqual(forecast.tightSlow, forecast.tightWith);
});

test('Example B: the 8-week Kaslijn', () => {
  const kaslijn = buildCashForecast(exampleB(), options({ horizonEnd: '2026-12-10', pastDays: 28 }));
  assert.equal(kaslijn.horizonEnd, '2026-12-10');
  assert.deepEqual(kaslijn.lowestBase, { day: '2026-12-01', eur: 13916.14, causes: ['PO-2026-043 · 70% bij vertrek', 'PO-2026-041 · Saldo bij aankomst'] });
  assert.deepEqual(kaslijn.tightWith, []);
  const largest = [...kaslijn.items].sort((left, right) => left.amountEur - right.amountEur)[0];
  assert.equal(largest.amountEur, -21000);
  assert.equal(largest.date, '2026-12-01');
  assert.equal(kaslijn.past.length, 28);
  assert.equal(kaslijn.past[kaslijn.past.length - 1].day, '2026-10-14');
  assert.equal(kaslijn.past[kaslijn.past.length - 1].eur, 32365.27);
});

test('Example B: months, past from the bank and future with the scenario values', () => {
  const forecast = buildCashForecast(exampleB(), options());
  const month = (label: string) => forecast.months.find((row) => row.label === label)!;
  assert.deepEqual(forecast.months.map((row) => row.label), ['sep', '1–15 okt', '15–31 okt', 'nov', 'dec', 'jan', 'feb', 'mrt', '1–15 apr']);
  const september = month('sep');
  assert.equal(september.past, true);
  assert.deepEqual([september.beginEur, september.endEur, september.lowestEur], [39500, 39500, 39500]);
  assert.deepEqual([september.containersOutEur, september.customersOtherEur, september.vatEur, september.costsEur, september.otherEur], [0, 0, 0, 0, 0]);
  const octoberPast = month('1–15 okt');
  assert.equal(octoberPast.key, '2026-10:past');
  assert.deepEqual([octoberPast.beginEur, octoberPast.customersOtherEur, octoberPast.costsEur, octoberPast.endEur, octoberPast.lowestEur, octoberPast.lowestDay],
    [39500, 3452, -10586.73, 32365.27, 31000, '2026-10-13']);
  const october = month('15–31 okt');
  assert.deepEqual([october.beginEur, october.customersOtherEur, october.vatEur, october.costsEur, october.endEur, october.lowestEur, october.lowestDay],
    [32365.27, 7501, -7412, -665.5, 31788.77, 31788.77, '2026-10-25']);
  const november = month('nov');
  assert.deepEqual([november.containersOutEur, november.customersOtherEur, november.costsEur, november.endEur], [-11608.4, 6050, -1962.23, 24268.14]);
  const december = month('dec');
  assert.deepEqual([december.containersOutEur, december.customersOtherEur, december.costsEur, december.endEur, december.lowestEur, december.lowestDay],
    [-21000, 15367, -1538.73, 17096.41, 13829.41, '2026-12-14']);
  const january = month('jan');
  assert.deepEqual([january.containersOutEur, january.vatEur, january.costsEur, january.endEur], [-6400, -11991.3, -1538.73, -2833.62]);
  assert.equal(month('feb').endEur, -4372.35);
  assert.equal(month('mrt').endEur, -5911.08);
  assert.equal(month('1–15 apr').endEur, -7449.81);
  /* begin + rows = end for every month. */
  for (const row of forecast.months) {
    if (row.beginEur === null || row.endEur === null) continue;
    const sum = Math.round((row.beginEur + row.containersOutEur + row.containersBackEur + row.customersOtherEur + row.vatEur + row.costsEur + row.otherEur) * 100);
    assert.equal(sum, Math.round(row.endEur * 100), row.label);
  }
});

test('Example B: the reconciliation with the Vooruitblik matches the series', () => {
  const forecast = buildCashForecast(exampleB(), options());
  const reconciliation = forecast.reconciliation;
  assert.equal(reconciliation.startLabel, 'Vooruitblik · als alles betaald en ontvangen is');
  assert.equal(reconciliation.startEur, 580.14);
  assert.deepEqual(reconciliation.lines, [
    { label: 'Rekeningen die niet meetellen', eur: -5300 },
    { label: 'Vaste kosten na de eerste 30 dagen', eur: -7693.65 },
    { label: 'Btw-aangiften', eur: -12263.3 },
    { label: 'Btw bij invoer', eur: -7140 },
    { label: 'Geaccepteerde offertes', eur: 3267 },
    { label: 'Partnervoorschotten nog te factureren', eur: 12100 },
    { label: 'Lijkt al betaald (niet dubbel geteld)', eur: 9000 },
  ]);
  assert.equal(reconciliation.endLabel, 'Wat vastligt op 15 apr');
  assert.equal(reconciliation.endEur, -7449.81);
  assert.equal(reconciliation.seriesEndEur, -7449.81);
  assert.equal(reconciliation.matches, true);
});

test('Example B, dismissed: the deposit counts again and the reconciliation still matches', () => {
  const forecast = buildCashForecast(exampleB(), options({ dismissed: ['103:container:43:SUPPLIER:ORDERED'] }));
  assert.deepEqual(forecast.likelyPaid, []);
  const deposit = forecast.items.find((item) => item.key === 'container:43:SUPPLIER:ORDERED')!;
  assert.deepEqual(row(deposit), ['2026-10-15', -9000, 'container:43:SUPPLIER:ORDERED', 'Vast · nu · bij bestelling']);
  assert.equal(lines(forecast)['Lijkt al betaald (niet dubbel geteld)'], undefined);
  assert.equal(forecast.endBaseEur, -16449.81);
  assert.equal(forecast.reconciliation.matches, true);
});

test('Example B, invoices switched off: invoices and the credit leave, "Uitgezet in Wat telt mee" takes them', () => {
  const forecast = buildCashForecast(exampleB(), options({ rulesOff: ['invoices'] }));
  assert.equal(forecast.items.some((item) => item.key.startsWith('invoice:') || item.key === 'credit'), false);
  assert.equal(lines(forecast)['Uitgezet in Wat telt mee'], -13551);
  assert.equal(forecast.endBaseEur, -21000.81);
  assert.equal(forecast.reconciliation.matches, true);
  assert.equal(forecast.ruleTotals.invoices, 13551);
});

test('Example B, costs switched off: open costs and recurring leave, recurring stays out of "Uitgezet"', () => {
  const forecast = buildCashForecast(exampleB(), options({ rulesOff: ['costs'] }));
  assert.equal(forecast.items.some((item) => item.kind === 'COST' || item.kind === 'RECURRING'), false);
  assert.equal(forecast.endBaseEur, 2871.57);
  assert.equal(lines(forecast)['Vaste kosten na de eerste 30 dagen'], 1538.73);
  assert.equal(lines(forecast)['Uitgezet in Wat telt mee'], 1089);
  assert.equal(forecast.reconciliation.matches, true);
  assert.equal(forecast.ruleTotals.costs, -(1089 + 6 * 1452 + 6 * 86.73));
});

test('Example B, 4 weeks: the Proximus of 14/11 lies between the horizon and today + 30', () => {
  const forecast = buildCashForecast(exampleB(), options({ horizonEnd: '2026-11-12' }));
  assert.equal(forecast.endBaseEur, 35963.27);
  const reconciliation = lines(forecast);
  assert.equal(reconciliation['Vaste kosten na de eerste 30 dagen'], 86.73);
  assert.equal(reconciliation['Btw-aangiften'], -7412);
  assert.equal(reconciliation['Na 12 nov'], 39008.4);
  assert.equal(forecast.reconciliation.matches, true);
});

test('Example B plus an unlinked VAT payment: the Q3 return counts as paid, once', () => {
  const vatLine = bankLine(106, K, '2026-10-14', -7412, 'FOD Financien BTW', 'Btw-aangifte Q3', 'COSTS', false);
  const vatMove = move(106, K, '2026-10-14T09:00:00Z', '2026-10-14', -7412);
  const input = exampleB({ bankLines: [...BANK_LINES, vatLine], movements: [...MOVEMENTS, vatMove],
    accounts: accounts({ k: { currentEur: 24953.27 } }), outlook: { bankEur: 30253.27, expectedEur: -6831.86, netOpenEur: -37085.13, upcoming30Eur: 1538.73 } });
  const forecast = buildCashForecast(input, options());
  assert.deepEqual(forecast.excludedItems.map((item) => item.key), ['container:43:SUPPLIER:ORDERED', 'vat:2026-Q3']);
  assert.equal(forecast.likelyPaid.find((match) => match.itemKey === 'vat:2026-Q3')!.reason, 'party');
  assert.equal(forecast.startEur, 24953.27);
  assert.equal(forecast.reconciliation.startEur, -6831.86);
  assert.equal(lines(forecast)['Btw-aangiften'], -4851.3);
  assert.equal(lines(forecast)['Lijkt al betaald (niet dubbel geteld)'], 9000);
  assert.equal(forecast.endBaseEur, -7449.81);
  assert.equal(forecast.reconciliation.matches, true);
});

test('Example B in relative mode: no reading on the counted account', () => {
  const input = exampleB({ accounts: accounts({ k: { currentEur: null, checkedAt: null, latestReading: null, firstReadingAtMs: null } }),
    outlook: { bankEur: null, expectedEur: -36794.86, netOpenEur: -37085.13, upcoming30Eur: 1538.73 } });
  const forecast = buildCashForecast(input, options());
  assert.equal(forecast.mode, 'relative');
  assert.equal(forecast.startEur, 0);
  assert.deepEqual(forecast.missingAccounts, ['KBC-zichtrekening']);
  assert.equal(forecast.reconciliation.startLabel, 'Vooruitblik · netto open positie');
  assert.equal(forecast.reconciliation.startEur, -37085.13);
  assert.equal(lines(forecast)['Rekeningen die niet meetellen'], undefined);
  assert.equal(forecast.reconciliation.matches, true);
});

test('a label-only account is in no start, excluded list or sum and keeps the mode absolute', () => {
  const label: ForecastAccount = { key: 'KBC ZAKELIJK', label: 'KBC Zakelijk', source: 'MANUAL', archived: false, countsInCash: true, currentEur: null,
    checkedAt: null, firstReadingAtMs: null, latestReading: null, labelOnly: true };
  const receipt: ForecastMovement = { key: 'payment:9', lineId: null, account: 'KBC ZAKELIJK', atMs: Date.parse('2026-10-09T10:00:00Z'), day: '2026-10-09', amountEur: 250 };
  const input = exampleB({ accounts: [...accounts(), label], movements: [...MOVEMENTS, receipt] });
  const forecast = buildCashForecast(input, options());
  assert.equal(forecast.mode, 'absolute');
  assert.equal(forecast.startEur, 32365.27);
  assert.equal(forecast.startAccounts.length, 1);
  assert.deepEqual(forecast.excludedAccounts.map((account) => account.key), [W]);
  assert.equal(forecast.reconciliation.matches, true);
  assert.equal(runningBalances(input.movements, input.accounts).get('bank:105')!.totalAfterEur, 37665.27);
  assert.equal(balanceHistory(input.movements, input.accounts, '2026-10-14', '2026-10-14')[0].eur, 32365.27);
});

test('the register reads like a bank statement: saldo of row n = saldo of row n−1 + bedrag', () => {
  for (const forecast of [buildCashForecast(exampleB(), options()), buildCashForecast(exampleC(), options({ scenario: true }))]) {
    const register = forecast.register;
    const today = register.findIndex((row) => row.kind === 'today');
    assert.equal(register[today].title, 'Vandaag · berekend saldo');
    assert.equal(register[today].balanceEur, forecast.startEur);
    for (let index = today + 1; index < register.length; index++) {
      assert.equal(Math.round(register[index].balanceEur! * 100), Math.round((register[index - 1].balanceEur! + register[index].amountEur) * 100));
    }
    assert.equal(register[register.length - 1].balanceEur, forecast.endWithEur);
    const past = register.filter((row) => row.kind === 'past');
    assert.deepEqual(past.map((row) => row.lineId), [101, 102, 103, 104, 105]);
    assert.equal(past[past.length - 1].balanceEur, 32365.27);
    assert.equal(past[2].title, 'Yunnan Pubei Flowers Co., Ltd');
  }
});

/* ------------------------------------------------------------------ Example C: the scenario */

function exampleC(): CashForecastInput {
  const stored: PurchaseOrderForecast[] = [{ orderId: 41, priceMode: null, markupPct: null, markupEurPerUnit: null, costBasis: null, sellWeeks: null,
    paymentDays: null, seasonal: null, included: false, expectedShipOn: null, orderDateOverride: null, updatedAt: null, actor: null }];
  return exampleB({
    stored,
    orders: [order43({ lines: [
      { productId: 501, name: 'Rozendoos rond rood M', quantity: 2000, externalEur: 22200, pricingEur: 23700, listUnitEur: 18.5, historicUnitEur: null, paceUnitsPerWeek: 126, aheadUnits: 0 },
      { productId: 502, name: 'Mini dome blush', quantity: 2000, externalEur: 14800, pricingEur: 15800, listUnitEur: 12, historicUnitEur: 10.8, paceUnitsPerWeek: 91, aheadUnits: 0 },
    ] }), order41()],
  });
}

test('Example C: the choice of PO-2026-043 comes from the history', () => {
  const input = exampleC();
  const choice = resolveChoice(input.orders[0], null, NO_DEFAULTS, input.history, TODAY);
  assert.equal(choice.priceMode, 'MARKUP_PCT');
  assert.equal(choice.markupPct, 50);
  assert.equal(choice.costBasis, 'EXTERNAL');
  assert.equal(choice.sellWeeks, 18);
  assert.equal(choice.defaultSellWeeks, 18);
  assert.equal(choice.paymentDays, 21);
  assert.equal(choice.seasonal, false);
  assert.equal(choice.seasonalAvailable, false);
  assert.equal(choice.included, true);
  assert.deepEqual(choice.origin, { priceMode: 'history', markupPct: 'history', markupEurPerUnit: 'history', costBasis: 'history', sellWeeks: 'history',
    paymentDays: 'history', seasonal: 'history', included: 'history' });
  const linked = resolveChoice(input.orders[0], { ...input.stored[0], orderId: 43, included: null, markupPct: 60 }, { ...NO_DEFAULTS, sellWeeks: 12 }, input.history, TODAY);
  assert.equal(linked.markupPct, 60);
  assert.equal(linked.origin.markupPct, 'stored');
  assert.equal(linked.sellWeeks, 12);
  assert.equal(linked.origin.sellWeeks, 'link');
});

test('Example C: weekly sales, the scenario totals and the slow band', () => {
  const forecast = buildCashForecast(exampleC(), options({ scenario: true }));
  const sales = forecast.items.filter((item) => item.kind === 'SALES');
  assert.equal(sales.length, 10);
  assert.deepEqual(sales.map((item) => item.date), ['2027-02-05', '2027-02-12', '2027-02-19', '2027-02-26', '2027-03-05', '2027-03-12', '2027-03-19', '2027-03-26', '2027-04-02', '2027-04-09']);
  assert.deepEqual(sales.map((item) => item.amountEur), [3453.34, 3453.34, 3453.34, 3453.34, 3453.34, 3453.34, 3453.33, 3453.33, 3453.33, 3453.33]);
  assert.ok(sales.every((item) => item.vatEur === 370));
  assert.equal(sales[0].vatDate, '2027-01-15');
  assert.equal(sales[0].title, 'PO-2026-043 · verkoop week 1/18');
  assert.equal(sales[0].ruleText, 'verkoop 15/01 + 21 d betaaltermijn');
  assert.equal(sales[0].layer, 'SCENARIO');
  assert.deepEqual(forecast.scenario, {
    sources: forecast.scenario.sources, salesExclEur: 30833.36, salesVatEur: 3700, inHorizonEur: 34533.36, vatPaidEur: 0, marginEur: 10277.76, afterHorizonEur: 27626.64,
  });
  const sources = forecast.scenario.sources;
  assert.deepEqual(sources.map((source) => [source.id, source.included, source.cashInHorizonEur]), [[41, false, 0], [43, true, 34533.36]]);
  const po43 = sources.find((source) => source.id === 43)!;
  assert.deepEqual([po43.units, po43.costEur, po43.backEur, po43.sub], [4000, 37000, 55500, 'Besteld · aankomst 8 jan']);
  assert.equal(forecast.endWithEur, 27083.55);
  assert.deepEqual(forecast.lowestWith, { day: '2027-02-01', eur: -4285.62, causes: ['Btw-aangifte Q4 2026', 'Huur loods Wilrijk'] });
  assert.deepEqual(forecast.tightWith.map((period) => [period.from, period.to]), [['2027-01-08', '2027-03-04']]);
  assert.equal(forecast.endSlowEur, 13270.23);
  assert.deepEqual([forecast.lowestSlow.day, forecast.lowestSlow.eur], ['2027-03-01', -5824.35]);
  assert.deepEqual(forecast.tightSlow.map((period) => [period.from, period.to]), [['2027-01-08', '2027-04-08']]);
  assert.equal(forecast.zeroWith, '2027-01-25');
  assert.equal(forecast.zeroBase, '2027-01-25');
  /* The base does not move with the scenario. */
  assert.equal(forecast.endBaseEur, -7449.81);
  assert.equal(forecast.reconciliation.matches, true);
  /* Sales of a container go to "Containers · terug". */
  assert.equal(forecast.months.find((row) => row.label === 'feb')!.containersBackEur, 13813.36);
});

test('Example C: the PO sheet of PO-2026-043', () => {
  const sheet = poSheet(exampleC(), options({ scenario: true }), 43)!;
  assert.equal(sheet.title, 'PO-2026-043');
  assert.deepEqual([sheet.paidEur, sheet.outstandingEur, sheet.backEur, sheet.netEur], [0, 37000, 55500, 18500]);
  assert.equal(sheet.marginPct, 33.3);
  assert.equal(sheet.breakEvenOn, '2027-04-23');
  assert.equal(sheet.breakEvenText, 'Terugverdiend op vr 23 apr · 15 weken na aankomst');
  assert.deepEqual(sheet.flows.map((flow) => [flow.date, flow.approx, flow.amountEur, flow.kind, flow.status]), [
    ['2026-10-13', false, -9000, 'likely', 'Lijkt al betaald · KBC-zichtrekening 13/10'],
    ['2026-11-24', true, -600, 'open', 'Afspraak · vertrek 01/12 − 7 d (inspectie)'],
    ['2026-12-01', true, -21000, 'open', 'Afspraak · bij vertrek · aankomst 08/01 − 38 d transit'],
    ['2027-01-10', true, -6400, 'open', 'Afspraak · aankomst 08/01 + 2 d'],
    [null, false, 2500, 'internal', 'intern, geen transactie'],
    ['2027-01-15', true, 55500, 'sales', '15 jan – 14 mei · 18 w · gelijkmatig · 21 d'],
  ]);
  assert.equal(sheet.flows[0].lineId, 103);
  assert.equal(sheet.flows[5].title, 'Verkoop · 4.000 stuks');
  assert.deepEqual(sheet.products.map((product) => [product.productId, product.units, product.costUnitEur, product.priceUnitEur, product.backEur]),
    [[501, 2000, 11.1, 16.65, 33300], [502, 2000, 7.4, 11.1, 22200]]);
  assert.deepEqual(sheet.salesWindow, { from: '2027-01-15', to: '2027-05-14', weeks: 18, text: '15 jan – 14 mei · 18 w · gelijkmatig · 21 d' });
  /* A window that runs into the next year names both years, so it never reads backwards ("15 jan – 7 jan"). */
  const year = poSheet(exampleC(), options({ scenario: true, defaults: { ...NO_DEFAULTS, sellWeeks: 52 } }), 43)!;
  assert.deepEqual(year.salesWindow, { from: '2027-01-15', to: '2028-01-07', weeks: 52, text: '15 jan 2027 – 7 jan 2028 · 52 w · gelijkmatig · 21 d' });
  assert.deepEqual(sheet.departure, { date: '2026-12-01', certainty: 'ESTIMATED', ruleText: 'aankomst 08/01 − 38 d transit', stored: false });
  assert.deepEqual(sheet.likelyPaid.map((match) => match.lineId), [103]);
  assert.equal(sheet.lane[0].day, '2026-10-13');
  assert.equal(sheet.lane[0].eur, -9000);
  assert.equal(sheet.lane.find((point) => point.day === '2027-04-23')!.eur, 0.02);
  assert.equal(sheet.lane[sheet.lane.length - 1].eur, 18500);
});

/* ------------------------------------------------------------------ Example D: the order-date suggestion */

test('Example D: order the concept on 16 November to stay above the buffer', () => {
  const input: CashForecastInput = {
    ...exampleB(), accounts: [accounts({ k: { currentEur: 20000 } })[0]], movements: [], bankLines: [], openCosts: [], recurring: [], advanceRows: [],
    quotes: [], openQuotes: [], vatQuarters: [], openCreditEur: 0,
    invoices: [{ salesOrderId: 600, number: 'F2026-0600', party: 'Bloemen Maes', partner: false, advance: false, dueDate: '2026-12-15', remainingEur: 15000, delayDays: 0 }],
    orders: [order43({ orderId: 45, number: 'PO-2026-045', status: 'CONCEPT', expectedArrival: null, importVatEur: 0, lines: [], orderDate: '2026-10-01' })],
    containerRows: [
      { key: 'container:45:SUPPLIER:ORDERED', orderId: 45, payee: 'SUPPLIER', due: 'ORDERED', termLabel: '30% bij bestelling', remainingEur: 6000, concept: true },
      { key: 'container:45:SUPPLIER:SHIPPED', orderId: 45, payee: 'SUPPLIER', due: 'SHIPPED', termLabel: '70% bij vertrek', remainingEur: 14000, concept: true },
    ],
    stored: [{ orderId: 45, priceMode: null, markupPct: null, markupEurPerUnit: null, costBasis: null, sellWeeks: null, paymentDays: null,
      seasonal: null, included: true, expectedShipOn: null, orderDateOverride: '2026-11-02', updatedAt: null, actor: null }],
    outlook: { bankEur: 20000, expectedEur: 35000, netOpenEur: 15000, upcoming30Eur: 0 },
  };
  const forecast = buildCashForecast(input, options({ scenario: true }));
  const concept = forecast.items.filter((item) => item.orderId === 45).map((item) => [item.date, item.amountEur, item.layer, item.certainty, item.ruleText]);
  assert.deepEqual(concept, [
    ['2026-11-02', -6000, 'SCENARIO', 'SCENARIO', 'bij bestelling 02/11'],
    ['2026-12-07', -14000, 'SCENARIO', 'ESTIMATED', 'bij vertrek · besteld 02/11 + 35 d levertijd'],
  ]);
  assert.deepEqual([forecast.lowestWith.day, forecast.lowestWith.eur], ['2026-12-07', 0]);
  assert.equal(forecast.reconciliation.matches, true);
  assert.deepEqual(suggestOrderDate(input, options({ scenario: true }), 45),
    { orderId: 45, currentDate: '2026-11-02', currentLowestEur: 0, currentLowestDay: '2026-12-07', suggestedDate: '2026-11-16', rule: 'buffer' });
  assert.equal(suggestOrderDate(input, options({ scenario: true }), 43), null);
});

/* ------------------------------------------------------------------ helpers */

test('distributeCents gives the leftover cents to the largest remainders, ties to the earlier index', () => {
  assert.deepEqual(distributeCents(5550000, Array(18).fill(1)), [...Array(6).fill(308334), ...Array(12).fill(308333)]);
  assert.deepEqual(distributeCents(1000, [1, 2, 1]), [250, 500, 250]);
  assert.deepEqual(distributeCents(100, [1, 1, 1]), [34, 33, 33]);
});

test('seasonalProfile weighs each calendar month against the mean; too little history gives null', () => {
  const months = Array.from({ length: 24 }, (_, index) => {
    const month = (index % 12) + 1;
    return { month: `${2025 + Math.floor(index / 12)}-${String(month).padStart(2, '0')}`, eur: month === 2 ? 30000 : month === 5 ? 20000 : 10000 };
  });
  assert.deepEqual(seasonalProfile(months), [0.8, 2.4, 0.8, 0.8, 1.6, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8]);
  assert.equal(seasonalProfile(months.slice(0, 11)), null);
});

test('parsePaymentTerms reads the usual Dutch terms', () => {
  assert.deepEqual(parsePaymentTerms('30 dagen netto'), { kind: 'net', days: 30, assumed: false });
  assert.deepEqual(parsePaymentTerms('14 dagen'), { kind: 'net', days: 14, assumed: false });
  assert.deepEqual(parsePaymentTerms('Bij levering'), { kind: 'net', days: 0, assumed: false });
  assert.deepEqual(parsePaymentTerms('Vooruitbetaling'), { kind: 'prepay' });
  assert.deepEqual(parsePaymentTerms('30/70'), { kind: 'split', firstPct: 30 });
  assert.deepEqual(parsePaymentTerms('50/50'), { kind: 'split', firstPct: 50 });
  assert.deepEqual(parsePaymentTerms('30/40/30'), { kind: 'split', firstPct: 30 });
  assert.deepEqual(parsePaymentTerms(null), { kind: 'net', days: 30, assumed: true });
  assert.deepEqual(parsePaymentTerms('Op afspraak'), { kind: 'net', days: 30, assumed: true });
});

test('defaultSellWeeks: the pace weighed by cost, a product without pace counts 52 weeks, clamped to 2..52', () => {
  assert.equal(defaultSellWeeks([{ basisEur: 22200, quantity: 2000, aheadUnits: 0, paceUnitsPerWeek: 126 }, { basisEur: 14800, quantity: 2000, aheadUnits: 0, paceUnitsPerWeek: 91 }]), 18);
  assert.equal(defaultSellWeeks([{ basisEur: 1000, quantity: 500, aheadUnits: 0, paceUnitsPerWeek: 0 }]), 52);
  assert.equal(defaultSellWeeks([{ basisEur: 1000, quantity: 10, aheadUnits: 0, paceUnitsPerWeek: 100 }]), 2);
  assert.equal(defaultSellWeeks([{ basisEur: 1000, quantity: 5000, aheadUnits: 1000, paceUnitsPerWeek: 10 }]), 52);
  assert.equal(defaultSellWeeks([]), 12);
});

const item = (key: string, amountEur: number, party: string | null, references: string[] = [], kind: ForecastItem['kind'] = 'SUPPLIER'): ForecastItem => ({
  key, layer: 'BASE', rule: 'containers', kind, certainty: 'FIXED', date: TODAY, originalDate: null, overdue: false, amountEur, vatEur: 0, vatDate: null,
  deductibleVatEur: 0, costEur: 0, title: key, party, ruleText: 'nu', orderId: null, source: { type: 'credit' }, references,
});

test('likelyPaid: reference beats party, a tie matches nothing, each line once, recent and free lines only', () => {
  const free = (id: number, amountEur: number, counterparty: string, reference: string, extra: Partial<ForecastBankLine> = {}) =>
    bankLine(id, K, '2026-10-10', amountEur, counterparty, reference, 'COSTS', false, extra);
  /* Reference beats party: the line names PO-2026-050 and the party of the other item. */
  const byReference = likelyPaid([item('a', -500, 'Acme Trading'), item('b', -500, 'Other Party', ['PO-2026-050'])],
    [free(1, -500, 'Acme Trading', 'PO-2026-050 deposit')], TODAY, []);
  assert.deepEqual(byReference.map((match) => [match.itemKey, match.reason]), [['b', 'reference']]);
  /* Two items with the same party and amount: ambiguous. */
  assert.deepEqual(likelyPaid([item('a', -500, 'Acme Trading'), item('b', -500, 'Acme Trading')], [free(1, -500, 'Acme Trading', 'x')], TODAY, []), []);
  /* One item, two lines: the most recent one; the other line stays free. */
  const twoLines = likelyPaid([item('a', -500, 'Acme Trading')], [free(1, -500, 'Acme Trading', 'x'), { ...free(2, -500, 'Acme Trading', 'y'), day: '2026-10-12' }], TODAY, []);
  assert.deepEqual(twoLines.map((match) => match.lineId), [2]);
  /* Older than 90 days, allocated, classified, other sign or amount: none. */
  assert.deepEqual(likelyPaid([item('a', -500, 'Acme Trading')], [{ ...free(1, -500, 'Acme Trading', 'x'), day: '2026-07-01' }], TODAY, []), []);
  assert.deepEqual(likelyPaid([item('a', -500, 'Acme Trading')], [free(1, -500, 'Acme Trading', 'x', { allocated: true })], TODAY, []), []);
  assert.deepEqual(likelyPaid([item('a', -500, 'Acme Trading')], [free(1, -500, 'Acme Trading', 'x', { classification: 'OTHER' })], TODAY, []), []);
  assert.deepEqual(likelyPaid([item('a', -500, 'Acme Trading')], [free(1, -500.05, 'Acme Trading', 'x')], TODAY, []), []);
  assert.equal(likelyPaid([item('a', -500, 'Acme Trading')], [free(1, -500.02, 'Acme Trading', 'x')], TODAY, []).length, 1);
  /* No signal, no match; dismissed, no match. */
  assert.deepEqual(likelyPaid([item('a', -500, 'Acme Trading')], [free(1, -500, 'Someone else', 'x')], TODAY, []), []);
  assert.deepEqual(likelyPaid([item('a', -500, 'Acme Trading')], [free(1, -500, 'Acme Trading', 'x')], TODAY, ['1:a']), []);
  /* Customers: incoming lines only. */
  assert.equal(likelyPaid([item('i', 1906, 'Maison Vert', ['F2026-0405'], 'CUSTOMER')], [{ ...free(1, 1906, 'MAISON VERT SRL', '+++F2026/0405+++') }], TODAY, [])[0].reason, 'reference');
});

test('import VAT: none for the Dutch fiscal representative or under ET 14000; an unconfirmed clearance says so', () => {
  const nl = buildCashForecast(exampleB({ orders: [order43({ clearance: 'NL_FISCAL_REP_TO_BE' }), order41()] }), options());
  assert.equal(nl.items.some((row) => row.kind === 'IMPORT_VAT'), false);
  const deferred = buildCashForecast(exampleB({ importVatDeferred: true }), options());
  assert.equal(deferred.items.some((row) => row.kind === 'IMPORT_VAT'), false);
  const covered = buildCashForecast(exampleB({ orders: [order43({ importVatCovered: true }), order41()] }), options());
  assert.equal(covered.items.some((row) => row.kind === 'IMPORT_VAT'), false);
  const unconfirmed = buildCashForecast(exampleB({ orders: [order43({ clearanceConfirmed: false }), order41()] }), options());
  assert.equal(unconfirmed.items.find((row) => row.kind === 'IMPORT_VAT')!.ruleText, 'btw bij invoer · inklaring België · ETA 08/01 · inklaring te bevestigen');
  assert.equal(nl.reconciliation.matches && deferred.reconciliation.matches && unconfirmed.reconciliation.matches, true);
});

test('VAT carry: a refund quarter carries into the next return', () => {
  const forecast = buildCashForecast(exampleB({ vatQuarters: [{ year: 2026, quarter: 3, knownNetEur: 1000 }, { year: 2026, quarter: 4, knownNetEur: -2184.3 }] }), options());
  assert.equal(forecast.items.some((row) => row.key === 'vat:2026-Q3'), false);
  /* −2.184,30 − 567,00 − 2.100,00 + the 1.000,00 carried from Q3. */
  assert.equal(forecast.items.find((row) => row.key === 'vat:2026-Q4')!.amountEur, -3851.3);
  assert.equal(forecast.reconciliation.matches, true);
});

test('weekend rule: a cash day on a Saturday moves to Monday', () => {
  const input = exampleC();
  const choice = { ...input.stored[0], orderId: 43, included: null, paymentDays: 22 };
  const forecast = buildCashForecast({ ...input, stored: [input.stored[0], choice] }, options({ scenario: true }));
  const first = forecast.items.find((row) => row.key === 'sales:43:0')!;
  /* Sale on Friday 15/01 + 22 d = Saturday 06/02 → Monday 08/02. */
  assert.equal(first.date, '2027-02-08');
});

test('an archived order keeps its open rows with their date rules, never import VAT or sales', () => {
  const input = exampleC();
  const archived = { ...input, orders: [order43({ archived: true, lines: input.orders[0].lines }), order41()] };
  const forecast = buildCashForecast(archived, options({ scenario: true }));
  assert.ok(forecast.items.some((row) => row.key === 'container:43:SUPPLIER:SHIPPED' && row.date === '2026-12-01'));
  assert.equal(forecast.items.some((row) => row.kind === 'IMPORT_VAT' || row.kind === 'SALES'), false);
  assert.equal(forecast.scenario.sources.some((source) => source.id === 43), false);
});

test('pins: the four largest moves of at least € 5.000, grouped within three days, numbered by date', () => {
  const forecast = buildCashForecast(exampleB(), options());
  assert.deepEqual(forecast.pins.map((pin) => [pin.n, pin.from, pin.to, pin.amountEur]), [
    [1, '2026-10-25', '2026-10-25', -7412],
    [2, '2026-11-18', '2026-11-18', -8690],
    [3, '2026-12-01', '2026-12-01', -8900],
    [4, '2027-01-08', '2027-01-10', -13540],
  ]);
  assert.equal(forecast.pins[2].label, 'PO-2026-043 · 70% bij vertrek · PO-2026-044 · 2e voorschot');
});
