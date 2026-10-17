import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import type { PurchaseOrderView } from '../src/app/core/api/models.ts';
import { NO_DEFAULTS, buildCashForecast, horizonEndOf } from '../src/app/features/finance/cash-forecast.ts';
import type { CashForecastInput, ForecastAccount, ForecastOrder } from '../src/app/features/finance/cash-forecast.ts';
import { agendaModel } from '../src/app/features/dashboard/agenda-entries.ts';
import type { CashHeadline } from '../src/app/features/dashboard/home-cash.ts';

/*
 * The agenda names containers through containerName(), as the Te doen rows do (owner rule, amendment G): the
 * forecast titles container terms, import VAT and advances by the PO number, and home-sources agendaInputOf
 * renames them to the Herkenbare naam - the 7-day chips, Daarna, the month's day list and the Agenda page all
 * read these entries. home-sources.ts imports its neighbours without an extension (Angular side): a resolve hook
 * adds '.ts' for this test process only.
 */
registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      try { return next(`${specifier}.ts`, context); } catch { /* not a .ts file: resolve as written */ }
    }
    return next(specifier, context);
  },
});
const { agendaInputOf, containerTitleOf } = await import('../src/app/features/dashboard/home-sources.ts');

const TODAY = '2026-10-15';
const K = 'BE94731074082814';
const READING = Date.parse('2026-10-14T21:59:59.999Z');
const account: ForecastAccount = { key: K, label: 'KBC-zichtrekening', source: 'ODOO', archived: false, countsInCash: true, currentEur: 90000,
  checkedAt: new Date(READING).toISOString(), firstReadingAtMs: READING, latestReading: { atMs: READING, balanceEur: 90000 }, labelOnly: false };

function order(orderId: number, number: string, extra: Partial<ForecastOrder> = {}): ForecastOrder {
  return { orderId, number, alias: null, status: 'BESTELD', partner: false, archived: false, supplierName: 'Yunnan Pubei Flowers Co., Ltd',
    orderDate: '2026-10-10', shippedOn: null, expectedArrival: '2027-01-08', receivedOn: null, leadTimeDays: 35, transitDays: 38,
    importVatEur: 0, importVatCovered: false, clearance: 'BE_CUSTOMS', clearanceConfirmed: true, paidEur: 0, remainingEur: 30000,
    internalMarkupEur: 0, lines: [], payments: [], ...extra };
}

function forecastInput(): CashForecastInput {
  return {
    today: TODAY, statementsFrom: null, accounts: [account], movements: [], bankLines: [], openCosts: [], recurring: [],
    containerRows: [
      { key: 'container:30:SUPPLIER:SHIPPED', orderId: 30, payee: 'SUPPLIER', due: 'SHIPPED', termLabel: '70% bij vertrek', remainingEur: 8669, concept: false },
      { key: 'container:30:LOGISTICS', orderId: 30, payee: 'LOGISTICS', due: null, termLabel: null, remainingEur: 6400, concept: false },
      { key: 'container:43:SUPPLIER:SHIPPED', orderId: 43, payee: 'SUPPLIER', due: 'SHIPPED', termLabel: '70% bij vertrek', remainingEur: 21000, concept: false },
    ],
    orders: [order(30, 'PO-2026-030', { alias: 'Valentijn 2027', importVatEur: 7140 }), order(43, 'PO-2026-043')],
    invoices: [{ salesOrderId: 420, number: 'F2026-0420', party: 'Bloemen Lotus', partner: false, advance: false, dueDate: '2026-10-21', remainingEur: 6235, delayDays: 0 }],
    openCreditEur: 0,
    advanceRows: [{ orderId: 47, orderNumber: 'PO-2026-047', rowId: 1, label: 'Voorschot 2', party: 'Kwekerij Van Gils', dueDate: '2026-11-05', amountInclEur: 6050, vatEur: 1050 }],
    quotes: [], openQuotes: [], vatQuarters: [], paidVatPeriods: [], importVatDeferred: false, products: [],
    history: { realisedMarkupPct: 50, paymentDays: 21, vatPct: 12, seasonal: null, openQuoteConversionPct: 0 },
    stored: [], bufferEur: 10000,
    outlook: { bankEur: 90000, expectedEur: 0, netOpenEur: 0, upcoming30Eur: 0 },
  };
}

const view = (id: number, number: string, alias: string | null) => ({ order: { id, number, alias } }) as unknown as PurchaseOrderView;
const headline: CashHeadline = { state: 'ready', startEur: 90000, accounts: [], lowest: null, tight: null, bufferEur: 10000, warnings: [] };

test('the agenda\'s money names its containers by containerName(): Herkenbare naam, else the PO number', () => {
  const forecast = buildCashForecast(forecastInput(), { horizonEnd: horizonEndOf(TODAY, 6), scenario: false, includeStock: false, rulesOff: [],
    openQuotesOn: false, defaults: NO_DEFAULTS, dismissed: [], pastDays: 42 });
  /* The forecast names the containers it carries itself (Analyses W5c); the home renames what it titled by number. */
  assert.ok(forecast.items.some((item) => item.title === 'Valentijn 2027 · 70% bij vertrek'));
  const input = agendaInputOf({
    today: TODAY, nowTime: '08:40', planner: [], milestones: [], forecast, headline,
    purchases: [view(30, 'PO-2026-030', 'Valentijn 2027'), view(43, 'PO-2026-043', null), view(47, 'PO-2026-047', 'Partner Van Gils')],
    sales: [], salesOk: true, customers: [],
    cash: { bankAccounts: [], balances: [], statements: [], recurring: [], bankLoaded: true }, vat: { paidPeriods: [], eurByDeadline: {} },
  });
  assert.equal(input.moneySource, 'prognose');
  assert.ok(input.money.some((money: { title: string }) => money.title === 'Factuur F2026-0420'), 'other money keeps its title');
  const titles = input.money.filter((money: { orderId: number | null }) => money.orderId !== null).map((money: { title: string }) => money.title).sort();
  assert.deepEqual(titles, [
    'PO-2026-043 · 70% bij vertrek', 'Partner Van Gils · Voorschot 2',
    'Valentijn 2027 · 70% bij vertrek', 'Valentijn 2027 · Douane & transport', 'Valentijn 2027 · btw bij invoer',
  ]);
  /* Daarna and the chips read the same entries. */
  const model = agendaModel(input);
  assert.equal(model.after(TODAY, 10).some((entry) => /PO-2026-0(30|47)/.test(entry.title)), false);
  assert.ok(model.after(TODAY, 10).some((entry) => entry.title === 'Valentijn 2027 · 70% bij vertrek'));
});

test('containerTitleOf only renames container and advance titles that start with the order\'s own prefix', () => {
  const orders = new Map([[30, { id: 30, number: 'PO-2026-030', alias: 'Valentijn 2027' }]]);
  const item = (title: string, type: string, orderId: number | null) => ({ title, orderId, source: { type, orderId: orderId ?? 0, rowId: 1 } }) as never;
  assert.equal(containerTitleOf(item('PO-2026-030 · 30% bij bestelling', 'container', 30), orders), 'Valentijn 2027 · 30% bij bestelling');
  /* An order the home did not load: the forecast's 'Inkoop #id' prefix becomes containerName's own fallback. */
  assert.equal(containerTitleOf(item('Inkoop #52 · Voorschot 1', 'advance', 52), orders), 'Inkoop #52 · Voorschot 1');
  assert.equal(containerTitleOf(item('Factuur F2026-0420', 'invoice', null), orders), 'Factuur F2026-0420');
  assert.equal(containerTitleOf(item('Offerte PO-2026-030 · x', 'quote', 30), orders), 'Offerte PO-2026-030 · x');
  /* A title the forecast did not prefix stays whole. */
  assert.equal(containerTitleOf(item('Containerkosten', 'container', 30), orders), 'Containerkosten');
});
