import assert from 'node:assert/strict';
import test from 'node:test';
import { NO_DEFAULTS, buildCashForecast, horizonEndOf } from '../src/app/features/finance/cash-forecast.ts';
import type { CashForecastInput, ForecastAccount, ForecastOptions } from '../src/app/features/finance/cash-forecast.ts';
import { agendaForecastMoney, agendaModel } from '../src/app/features/dashboard/agenda-entries.ts';
import type { AgendaInput } from '../src/app/features/dashboard/agenda-entries.ts';
import { COVERAGE_ORDER, homeTasks, vatCashByDeadline } from '../src/app/features/dashboard/home-priority.ts';
import type { CoverageSource, HomeTaskInput } from '../src/app/features/dashboard/home-priority.ts';

/*
 * The home's adapters on the REAL 6-month forecast (cash-forecast.ts), not on hand-made maps: the VAT row
 * after the 25th (vatCashByDeadline, as home-sources vatOf uses it) and the forecast's money in the agenda
 * (agendaForecastMoney, as home-sources agendaInputOf uses it). A trimmed Example B of the bank round.
 */

const TODAY = '2026-10-15';   // Thursday
const K = 'BE94731074082814';
const READING = Date.parse('2026-10-14T21:59:59.999Z');
const account: ForecastAccount = { key: K, label: 'KBC-zichtrekening', source: 'ODOO', archived: false, countsInCash: true, currentEur: 32365.27,
  checkedAt: new Date(READING).toISOString(), firstReadingAtMs: READING, latestReading: { atMs: READING, balanceEur: 32365.27 }, labelOnly: false };

function forecastInput(today: string, extra: Partial<CashForecastInput> = {}): CashForecastInput {
  return {
    today, statementsFrom: null, accounts: [account], movements: [], bankLines: [],
    openCosts: [{ costId: 11, title: 'Boekhouder Q3', party: 'Fiduciaire Peeters', date: '2026-10-08', dueDate: null, openEur: 665.5 }],
    recurring: [], containerRows: [], orders: [],
    invoices: [
      { salesOrderId: 300, number: 'F2026-0300', party: 'Bloemen Maes', partner: false, advance: false, dueDate: '2026-05-20', remainingEur: 2000, delayDays: 0 },
      { salesOrderId: 405, number: 'F2026-0405', party: 'Maison Vert', partner: false, advance: false, dueDate: '2026-10-02', remainingEur: 6200, delayDays: 0 },
      { salesOrderId: 420, number: 'F2026-0420', party: 'Bloemen Lotus', partner: false, advance: false, dueDate: '2026-10-21', remainingEur: 4235, delayDays: 0 },
    ],
    openCreditEur: 0, advanceRows: [], quotes: [], openQuotes: [],
    vatQuarters: [{ year: 2026, quarter: 3, knownNetEur: -7412 }, { year: 2026, quarter: 4, knownNetEur: -2184.3 }],
    paidVatPeriods: [], importVatDeferred: false, products: [],
    history: { realisedMarkupPct: 50, paymentDays: 21, vatPct: 12, seasonal: null, openQuoteConversionPct: 0 },
    stored: [], bufferEur: 10000,
    outlook: { bankEur: 32365.27, expectedEur: 0, netOpenEur: 0, upcoming30Eur: 0 },
    ...extra,
  };
}
const options = (today: string): ForecastOptions => ({ horizonEnd: horizonEndOf(today, 6), scenario: false, includeStock: false, rulesOff: [],
  openQuotesOn: false, defaults: NO_DEFAULTS, dismissed: [], pastDays: 42 });

/* ------------------------------------------------------------- VAT row */

const allSources = Object.fromEntries(COVERAGE_ORDER.map((source) => [source, true])) as Record<CoverageSource, boolean>;
function vatRow(today: string, paidPeriods: string[] = []) {
  const input = forecastInput(today, { paidVatPeriods: paidPeriods });
  const forecast = buildCashForecast(input, options(today));
  const tasks: HomeTaskInput = {
    today, nowMs: Date.parse(`${today}T06:40:00Z`), planner: [], customers: [], loginRequests: 0, containerDue: [],
    advances: { count: 0, eur: 0, overdueEur: 0, first: null }, settlements: 0, invoicesOverdue: [], overdueCosts: null,
    vat: { paidPeriods, eurByDeadline: vatCashByDeadline(forecast.items, input.vatQuarters, today) },
    tight: null, arrivals: [], purchaseCheck: 0, catalog: 0, housekeeping: [], later: {}, taskKeys: [], sources: allSources,
  };
  const list = homeTasks(tasks);
  return [...list.top, ...list.more, ...list.ookNog].find((task) => task.source === 'vat');
}

test('the unpaid Q3 return stays on the home after the 25th, through the real forecast', () => {
  assert.deepEqual([vatRow('2026-10-15')?.tier, vatRow('2026-10-15')?.chip.label, vatRow('2026-10-15')?.eur], ['vandaag', 'nog 10 dagen', 7412]);
  assert.deepEqual([vatRow('2026-10-25')?.tier, vatRow('2026-10-25')?.chip.label], ['nu', 'vandaag uiterste dag']);
  /* The forecast itself has let Q3 go from the 26th on. */
  const after = buildCashForecast(forecastInput('2026-10-26'), options('2026-10-26'));
  assert.equal(after.items.some((item) => item.layer === 'BASE' && item.source.type === 'vat' && item.source.quarter === 3), false);
  const late = vatRow('2026-10-26');
  assert.deepEqual([late?.tier, late?.chip.label, late?.eur, late?.daysLate], ['nu', '1 d te laat', 7412, 1]);
  assert.deepEqual([vatRow('2026-11-02')?.chip.label, vatRow('2026-11-08')?.chip.label], ['8 d te laat', '14 d te laat']);
  assert.equal(vatRow('2026-11-09'), undefined);
  /* Paid in the bank: never late. */
  assert.equal(vatRow('2026-10-26', ['2026-Q3']), undefined);
});

/* ---------------------------------------------------------- agenda money */

test('the agenda leaves the forecast\'s overdue items out: they are task rows, not today\'s money', () => {
  const forecast = buildCashForecast(forecastInput(TODAY), options(TODAY));
  const overdue = forecast.items.filter((item) => item.layer === 'BASE' && item.overdue).map((item) => item.title).sort();
  assert.deepEqual(overdue, ['Boekhouder Q3', 'Factuur F2026-0300', 'Factuur F2026-0405']);
  const money = agendaForecastMoney(forecast.items, '2026-10-25');
  assert.equal(money.some((item) => item.overdue || item.date < TODAY), false);
  assert.equal(money.some((item) => item.source.type === 'vat' && item.source.quarter === 3), false, 'the VAT deadline is its own entry');
  assert.ok(money.some((item) => item.title === 'Factuur F2026-0420'));
  const model = agendaModel({
    today: TODAY, nowTime: '08:40', moneySource: 'prognose', vatDeadline: null, tight: null, milestones: [],
    money: money.map((item) => ({ date: item.date, eur: item.amountEur, title: item.title, party: item.party, orderId: item.orderId, link: null })),
    items: [{ id: 1, kind: 'EVENT', title: 'Klant Peeters', onDate: TODAY, atTime: '14:00', note: null, done: false, pinned: false, parentId: null }],
  } satisfies AgendaInput);
  assert.deepEqual((model.byDay.get(TODAY) ?? []).map((entry) => entry.title), ['Klant Peeters']);
  assert.equal(model.markers(TODAY).bigMoney, false);
});
