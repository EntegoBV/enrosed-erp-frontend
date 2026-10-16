import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { filingDeadline } from '../src/app/features/finance/finance-metrics.ts';
import { OVERDUE_COST_DAYS } from '../src/app/features/finance/finance-attention.ts';
import {
  ADVANCE_SOON_DAYS, COVERAGE_ORDER, CUSTOMER_WAIT_NU_WORKDAYS, HOME_TASK_CAP, KRAP_WITHIN_DAYS, LATER_ESCALATE_COUNT,
  OVERDUE_COST_DAYS_COPY, OVERDUE_INVOICE_MIN_EUR, OVERDUE_INVOICE_NU_DAYS, VAT_LATE_SHOW_DAYS, VAT_NU_DAYS, VAT_SHOW_DAYS,
  coverageOf, filingDeadlineOf, fnv1a8, forecastAnswer, homeMarker, homeMarkersOf, homeTasks, laterNext, laterPruned, nextWorkday,
  stripHomeMarkers, vatCashByDeadline, whyOrderLines, workdaysBetween,
  type CoverageAnswer, type CoverageSource, type HomeTask, type HomeTaskInput, type HomeTaskList,
} from '../src/app/features/dashboard/home-priority.ts';

const TODAY = '2026-10-15';   // Thursday
const allSources = Object.fromEntries(COVERAGE_ORDER.map((source) => [source, true])) as Record<CoverageSource, boolean>;
const input = (changes: Partial<HomeTaskInput> = {}, today = TODAY): HomeTaskInput => ({
  today, nowMs: Date.parse(`${today}T06:40:00Z`),
  planner: [], customers: [], loginRequests: 0, containerDue: [],
  advances: { count: 0, eur: 0, overdueEur: 0, first: null }, settlements: 0, invoicesOverdue: [], overdueCosts: null,
  vat: { paidPeriods: ['2026-Q3', '2026-Q4'], eurByDeadline: {} }, tight: null, arrivals: [], purchaseCheck: 0, catalog: 0,
  housekeeping: [], later: {}, taskKeys: [], sources: allSources, ...changes,
});
const all = (list: HomeTaskList): HomeTask[] => [...list.top, ...list.more, ...list.ookNog];
const bySource = (list: HomeTaskList, source: string): HomeTask | undefined => all(list).find((task) => task.source === source);
const plain = (text: string | undefined): string => (text ?? '').replace(/[  ]/g, ' ');
const days = (from: string, n: number): string => new Date(Date.parse(`${from}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/* ------------------------------------------------------------- 1. VAT */

const vatOn = (today: string, vat: HomeTaskInput['vat']): HomeTask | undefined =>
  bySource(homeTasks(input({ vat }, today)), 'vat');
const unpaid = { paidPeriods: [] as string[], eurByDeadline: { '2026-10-25': -3918.4 } };

test('VAT Q3 2026: shows from 10 days before the 25th, Nu from 3 days, late for at most 14 days', () => {
  assert.equal(vatOn('2026-10-14', unpaid), undefined);
  const first = vatOn('2026-10-15', unpaid);
  assert.equal(first?.tier, 'vandaag');
  assert.equal(first?.chip.label, 'nog 10 dagen');
  assert.equal(first?.title, 'Btw-aangifte Q3 indienen');
  assert.equal(plain(first?.context), 'uiterste dag zo 25 okt');
  assert.equal(first?.eur, 3918.4);
  assert.deepEqual(first?.target, { kind: 'finance', location: { view: 'analysis', tab: 'vat', year: '2026', quarter: '3' } });
  assert.equal(vatOn('2026-10-21', unpaid)?.tier, 'vandaag');
  assert.deepEqual([vatOn('2026-10-22', unpaid)?.tier, vatOn('2026-10-22', unpaid)?.chip.label], ['nu', 'nog 3 dagen']);
  assert.deepEqual([vatOn('2026-10-25', unpaid)?.tier, vatOn('2026-10-25', unpaid)?.chip.label], ['nu', 'vandaag uiterste dag']);
  const late = vatOn('2026-10-26', unpaid);
  assert.deepEqual([late?.tier, late?.chip.label, late?.daysLate], ['nu', '1 d te laat', 1]);
  assert.equal(vatOn('2026-10-26', { ...unpaid, paidPeriods: null }), undefined);
  assert.deepEqual([vatOn('2026-11-08', unpaid)?.tier, vatOn('2026-11-08', unpaid)?.chip.label], ['nu', '14 d te laat']);
  assert.equal(vatOn('2026-11-09', unpaid), undefined);
});

test('VAT: a paid quarter never shows; a refund or zero quarter drops off after the 25th', () => {
  for (let day = '2026-10-10'; day <= '2026-11-10'; day = days(day, 1)) {
    assert.equal(vatOn(day, { paidPeriods: ['2026-Q3'], eurByDeadline: unpaid.eurByDeadline }), undefined, day);
  }
  assert.equal(vatOn('2026-10-15', { paidPeriods: [], eurByDeadline: {} })?.eur, null);
  assert.equal(vatOn('2026-10-15', { paidPeriods: null, eurByDeadline: {} })?.tier, 'vandaag');
  assert.equal(vatOn('2026-10-26', { paidPeriods: [], eurByDeadline: { '2026-10-25': 512 } }), undefined);
  assert.equal(vatOn('2026-10-26', { paidPeriods: [], eurByDeadline: {} }), undefined);
  assert.equal(vatOn('2026-10-26', { paidPeriods: [], eurByDeadline: { '2026-10-25': 0 } }), undefined);
});

test('VAT cash per deadline: the BASE items; after the 25th the known net of the closed quarter when it is to pay', () => {
  const vat = (year: number, quarter: number, amountEur: number, layer = 'BASE') => ({ layer, amountEur, source: { type: 'vat', year, quarter } });
  const items = [vat(2026, 3, -7412), vat(2026, 4, -4851.3), vat(2026, 4, -100.1, 'SCENARIO'), { layer: 'BASE', amountEur: -5, source: { type: 'cost' } }];
  const quarters = [{ year: 2026, quarter: 3, knownNetEur: -7412 }, { year: 2026, quarter: 4, knownNetEur: -2184.3 }];
  assert.deepEqual(vatCashByDeadline(items, quarters, '2026-10-15'), { '2026-10-25': -7412, '2027-01-25': -4851.3 });
  /* From the 26th the forecast drops Q3; its known net stands in. */
  assert.deepEqual(vatCashByDeadline(items.slice(1), quarters, '2026-10-26'), { '2026-10-25': -7412, '2027-01-25': -4851.3 });
  /* A refund or a zero quarter stays out, so the row drops off as before. */
  assert.deepEqual(vatCashByDeadline([], [{ year: 2026, quarter: 3, knownNetEur: 512 }], '2026-10-26'), {});
  assert.deepEqual(vatCashByDeadline([], [{ year: 2026, quarter: 3, knownNetEur: 0 }], '2026-10-26'), {});
  assert.deepEqual(vatCashByDeadline([], [], '2026-10-26'), {});
  /* Q4 closes on 25 January of the next year. */
  assert.deepEqual(vatCashByDeadline([], [{ year: 2026, quarter: 4, knownNetEur: -900 }], '2027-01-27'), { '2027-01-25': -900 });
});

test('VAT Q4 files by 25 January of the next year', () => {
  const q4 = vatOn('2027-01-15', { paidPeriods: [], eurByDeadline: {} });
  assert.equal(q4?.title, 'Btw-aangifte Q4 indienen');
  assert.equal(q4?.due, '2027-01-25');
  assert.equal(q4?.chip.label, 'nog 10 dagen');
  assert.equal(q4?.key, 'vat:2026-Q4');
});

/* ------------------------------------------------------- 2. parity */

test('the filing deadline copy matches finance-metrics', () => {
  for (const [year, quarter] of [[2026, 1], [2026, 2], [2026, 3], [2026, 4], [2027, 1]]) {
    assert.equal(filingDeadlineOf(year, quarter), filingDeadline(year, quarter), `${year} Q${quarter}`);
  }
});

/* ---------------------------------------------------------- 3. invoices */

const invoice = (id: number, remainingEur: number, dueDate = '2026-10-01', customer = `Klant ${id}`) =>
  ({ id, number: `F2026-0${id}`, customer, dueDate, remainingEur });

test('overdue invoices: from € 1.000 each into one Vandaag row, smaller ones into Ook nog', () => {
  const small = homeTasks(input({ invoicesOverdue: [invoice(1, 999.99)] }));
  assert.equal(small.count, 0);
  assert.equal(small.ookNog[0].source, 'small-invoices');
  assert.equal(small.ookNog[0].title, 'Factuur F2026-01 opvolgen');
  const one = homeTasks(input({ invoicesOverdue: [invoice(2, 1000)] }));
  assert.equal(bySource(one, 'overdue-invoices')?.tier, 'vandaag');
  const mixed = homeTasks(input({ invoicesOverdue: [invoice(3, 2500.5, '2026-09-20', 'Bloemenhuis Lier'), invoice(4, 1200), invoice(5, 500)] }));
  const big = bySource(mixed, 'overdue-invoices')!;
  assert.deepEqual([big.tier, big.count, big.eur, big.title, big.daysLate], ['vandaag', 2, 3700.5, '2 facturen opvolgen', 25]);
  assert.equal(plain(big.context), 'Over de vervaldag · oudste Bloemenhuis Lier, 25 dagen');
  assert.equal(big.chip.label, '25 d te laat');
  assert.deepEqual(big.target, { kind: 'route', path: ['/sales'], query: { scope: 'ALL', tab: 'FACTUUR', payment: 'open' } });
  assert.deepEqual([bySource(mixed, 'small-invoices')?.tier, bySource(mixed, 'small-invoices')?.count], ['ooknog', 1]);
  assert.equal(mixed.count, 1);
  assert.equal(mixed.total, 2);
});

test('the oldest big invoice more than 45 days late escalates to Nu', () => {
  const at45 = homeTasks(input({ invoicesOverdue: [invoice(1, 1500, days(TODAY, -OVERDUE_INVOICE_NU_DAYS))] }));
  assert.equal(bySource(at45, 'overdue-invoices')?.tier, 'vandaag');
  const at46 = homeTasks(input({ invoicesOverdue: [invoice(1, 1500, days(TODAY, -OVERDUE_INVOICE_NU_DAYS - 1)), invoice(2, 1100, TODAY)] }));
  const row = bySource(at46, 'overdue-invoices')!;
  assert.deepEqual([row.tier, row.escalated, row.count, row.chip.tone], ['nu', true, 1, 'danger']);
});

/* --------------------------------------------------------- 4. customers */

const customer = (kind: string, orderNumber: string, at: string | null = '2026-10-15T07:00:00Z') =>
  ({ kind, title: kind, orderNumber, customer: 'Klant', at, detail: '' });

test('customers waiting are ONE row with the bell count', () => {
  assert.equal(bySource(homeTasks(input()), 'customers'), undefined);
  const single = bySource(homeTasks(input({ customers: [customer('LEVERTERMIJN', 'OF1')] })), 'customers')!;
  assert.deepEqual([single.title, single.count, single.tier], ['Klanten wachten', 1, 'vandaag']);
  const five = homeTasks(input({ customers: [customer('WEBSITE_AANVRAAG', 'OF1'), customer('WEBSITE_AANVRAAG', 'OF2'),
    customer('VOORSTEL', 'OF3'), customer('LEVERTERMIJN', 'OF4'), customer('VRACHT', 'OF5'), customer('OPNIEUW_VERSTUREN', 'OF6')].slice(0, 5) }));
  const rows = all(five).filter((task) => task.source === 'customers');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 5);
  assert.equal(rows[0].context, '2 websiteaanvragen · wijziging · levertermijn · vracht');
  assert.deepEqual(rows[0].target, { kind: 'bell' });
  const resend = bySource(homeTasks(input({ customers: [customer('OPNIEUW_VERSTUREN', 'OF6')] })), 'customers')!;
  assert.equal(resend.context, 'opnieuw versturen');
});

function customerCases(): unknown {
  const at = '2026-10-15T07:00:00Z';   // Thursday 09:00 in Brussels
  const on = (today: string, nowIso: string, when: string | null = at) => {
    const task = bySource(homeTasks(input({ today, nowMs: Date.parse(nowIso), customers: [customer('VRACHT', 'OF1', when)] }, today)), 'customers')!;
    return [task.tier, task.chip.label, task.escalated];
  };
  return {
    thursday: on('2026-10-15', '2026-10-15T18:50:00Z'),
    friday: on('2026-10-16', '2026-10-16T08:00:00Z'),
    monday: on('2026-10-19', '2026-10-19T07:00:00Z'),
    noTime: on('2026-10-19', '2026-10-19T07:00:00Z', null),
    lateEvening: on('2026-10-16', '2026-10-16T08:00:00Z', '2026-10-14T22:30:00Z'),
  };
}
const customerExpect = {
  thursday: ['vandaag', 'Wacht 11 u', false],
  friday: ['vandaag', 'Wacht 1 werkdag', false],
  monday: ['nu', 'Wacht 2 werkdagen', true],
  noTime: ['vandaag', 'Klant wacht', false],
  lateEvening: ['vandaag', 'Wacht 1 werkdag', false],
};

test('a customer waiting 2 workdays moves to Nu; the weekend does not count', () => {
  assert.deepEqual(customerCases(), customerExpect);
  assert.equal(workdaysBetween('2026-10-15', '2026-10-16'), 1);
  assert.equal(workdaysBetween('2026-10-15', '2026-10-19'), 2);
  assert.equal(workdaysBetween('2026-10-16', '2026-10-18'), 0);
  assert.equal(CUSTOMER_WAIT_NU_WORKDAYS, 2);
});

test('the customer wait reads the same under TZ=UTC', () => {
  const moduleUrl = new URL('../src/app/features/dashboard/home-priority.ts', import.meta.url).href;
  const script = `import * as home from ${JSON.stringify(moduleUrl)};
    const sources = Object.fromEntries(home.COVERAGE_ORDER.map((s) => [s, true]));
    const base = (today, nowIso, at) => ({ today, nowMs: Date.parse(nowIso), planner: [], customers: [{ kind: 'VRACHT', title: 'x', orderNumber: 'OF1', customer: null, at, detail: '' }],
      loginRequests: 0, containerDue: [], advances: { count: 0, eur: 0, overdueEur: 0, first: null }, settlements: 0, invoicesOverdue: [],
      overdueCosts: null, vat: { paidPeriods: ['2026-Q3'], eurByDeadline: {} }, tight: null, arrivals: [], purchaseCheck: 0, catalog: 0,
      housekeeping: [], later: {}, taskKeys: [], sources });
    const pick = (today, nowIso, at) => { const t = home.homeTasks(base(today, nowIso, at)).top[0]; return [t.tier, t.chip.label]; };
    console.log(JSON.stringify([
      pick('2026-10-15', '2026-10-15T18:50:00Z', '2026-10-15T07:00:00Z'),
      pick('2026-10-16', '2026-10-16T08:00:00Z', '2026-10-15T07:00:00Z'),
      pick('2026-10-19', '2026-10-19T07:00:00Z', '2026-10-15T07:00:00Z'),
      pick('2026-10-16', '2026-10-16T08:00:00Z', '2026-10-14T22:30:00Z'),
    ]));`;
  const output = execFileSync(process.execPath,
    ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--experimental-strip-types', '--input-type=module', '-e', script],
    { encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } });
  assert.deepEqual(JSON.parse(output), [['vandaag', 'Wacht 11 u'], ['vandaag', 'Wacht 1 werkdag'], ['nu', 'Wacht 2 werkdagen'],
    ['vandaag', 'Wacht 1 werkdag']]);
});

/* -------------------------------------------------------------- 5. krap */

const tight = (from: string) => ({ from, to: days(from, 8), lowestEur: 7940, lowestDay: days(from, 3), bufferEur: 10000 });

test('"Bank wordt krap" is Nu when the tight period starts within 14 days', () => {
  const row = bySource(homeTasks(input({ tight: tight(days(TODAY, KRAP_WITHIN_DAYS)) })), 'krap')!;
  assert.deepEqual([row.tier, row.chip.label, row.eur], ['nu', 'over 14 d', 7940]);
  assert.equal(plain(row.title), 'Bank wordt krap · 29 okt–6 nov');
  assert.equal(plain(row.context), 'laagste € 7.940 op zo 1 nov · buffer € 10.000');
  assert.deepEqual(row.target, { kind: 'cash' });
  assert.equal(bySource(homeTasks(input({ tight: tight(days(TODAY, KRAP_WITHIN_DAYS + 1)) })), 'krap'), undefined);
  assert.equal(bySource(homeTasks(input({ tight: null })), 'krap'), undefined);
  assert.equal(plain(bySource(homeTasks(input({ tight: { ...tight('2026-11-03'), to: '2026-11-11' } }, '2026-10-25')), 'krap')?.title),
    'Bank wordt krap · 3–11 nov');
  assert.equal(bySource(homeTasks(input({ tight: tight(TODAY) })), 'krap')?.chip.label, 'nu');
});

/* ----------------------------------------------------------- 6. planner */

const task = (id: number, onDate: string | null, changes: Partial<HomeTaskInput['planner'][number]> = {}) =>
  ({ id, kind: 'TASK' as const, title: `Taak ${id}`, onDate, done: false, pinned: false, note: null, ...changes });

test('planner tasks: late → Nu, today → Vandaag, pinned within 7 days or undated → Vandaag', () => {
  const list = homeTasks(input({ planner: [
    task(1, '2026-10-13', { note: 'Boekhouder wacht\n[home:vat:2026-Q3#0123abcd]' }), task(2, TODAY), task(3, '2026-10-16'),
    task(4, '2026-10-09', { done: true }), { ...task(5, TODAY), kind: 'EVENT' }, task(6, days(TODAY, 7), { pinned: true }),
    task(7, days(TODAY, 8), { pinned: true }), task(8, null, { pinned: true }), task(9, null),
  ] }));
  const tiers = Object.fromEntries(all(list).map((row) => [row.plannerId, [row.tier, row.chip.label]]));
  assert.deepEqual(tiers, {
    1: ['nu', '2 d te laat'], 2: ['vandaag', 'Vandaag'], 6: ['vandaag', 'Vastgepind'], 8: ['vandaag', 'Vastgepind'],
  });
  const late = all(list).find((row) => row.plannerId === 1)!;
  assert.equal(late.context, 'Taak · gepland di 13 okt · Boekhouder wacht');
  assert.deepEqual([late.verb, late.actions, late.target], ['Morgen', ['klaar', 'morgen'], { kind: 'planner', id: 1 }]);
  assert.equal(all(list).find((row) => row.plannerId === 8)?.context, 'Taak · zonder dag');
  const today = all(list).find((row) => row.plannerId === 2)!;
  assert.deepEqual([today.verb, today.actions], ['Morgen', ['klaar', 'morgen']]);
});

test('planner tasks: Morgen never pulls a pinned task forward, nor gives an undated one a day', () => {
  const list = homeTasks(input({ planner: [task(6, days(TODAY, 7), { pinned: true }), task(8, null, { pinned: true }),
    task(10, TODAY, { pinned: true })] }));
  const row = (id: number) => all(list).find((item) => item.plannerId === id)!;
  /* Pinned for Thu 22 Oct on Thu 15 Oct: Morgen would move it to Fri 16 Oct, six days earlier. */
  assert.deepEqual([row(6).verb, row(6).actions, row(6).target], ['Openen', ['klaar'], { kind: 'planner', id: 6 }]);
  assert.deepEqual([row(8).verb, row(8).actions], ['Openen', ['klaar']]);
  assert.deepEqual([row(10).verb, row(10).actions], ['Morgen', ['klaar', 'morgen']]);
});

/* --------------------------------------------------------------- 7. cap */

test('the home shows at most 7 Nu and Vandaag rows; Ook nog never fills the top', () => {
  const nine = homeTasks(input({ planner: Array.from({ length: 9 }, (_, i) => task(i + 1, days(TODAY, -i))) }));
  assert.deepEqual([nine.top.length, nine.more.length, nine.count, nine.total], [HOME_TASK_CAP, 2, 9, 9]);
  const few = homeTasks(input({
    planner: [task(1, TODAY), task(2, '2026-10-12')], loginRequests: 2,
    purchaseCheck: 4, settlements: 1, catalog: 2, invoicesOverdue: [invoice(1, 200)],
    housekeeping: [{ kind: 'bank-lines', count: 13, eur: 4200, title: '13 banktransacties nog te koppelen', detail: 'laatste 3 maanden',
      location: { view: 'bank', tab: 'movements', link: 'unlinked' } }],
  }));
  assert.deepEqual([few.top.length, few.more.length, few.ookNog.length, few.count, few.total], [3, 0, 5, 3, 8]);
  assert.ok(few.top.every((row) => row.tier !== 'ooknog'));
});

/* ------------------------------------------------------------- 8. order */

test('within a tier: days late, then due day, then amount, then source, then title', () => {
  const list = homeTasks(input({
    planner: [task(1, TODAY, { title: 'Bellen' }), task(2, TODAY, { title: 'Aanbod' })],
    arrivals: [{ orderId: 47, label: 'Moederdag', date: days(TODAY, 1), sub: '2.400 st · Yunnan Pubei' }],
    vat: { paidPeriods: [], eurByDeadline: { '2026-10-25': -2184 } },
    invoicesOverdue: [invoice(1, 4000, '2026-10-05')], loginRequests: 1,
    customers: [customer('VRACHT', 'OF5')],
    overdueCosts: { count: 2, eur: 300, oldestDays: 41, title: '2 open kosten ouder dan 30 dagen', location: { view: 'open', tab: 'costs' } },
    containerDue: [{ orderId: 43, label: 'PO-2026-043', eur: 100 }],
    advances: { count: 1, eur: 5000, overdueEur: 5000, first: { orderId: 47, label: 'Moederdag', due: TODAY } },
  }));
  assert.deepEqual(list.top.concat(list.more).map((row) => row.key), [
    'advance:47', 'container-due:43',
    'overdue-invoices', 'planner:2', 'planner:1', 'arrival:47:2026-10-16', 'vat:2026-Q3', 'overdue-costs', 'customers', 'login',
  ]);
});

/* ------------------------------------------------------------- 9. Later */

const hk = (count = 2) => ({ kind: 'recurring-due' as const, count, eur: null, title: `${count} vaste kosten staan klaar om te boeken`,
  detail: 'Na het boeken staan ze bij Te betalen', location: { view: 'costs', tab: 'recurring' } });

test('Later hides until the next workday and returns when the detail changes', () => {
  const row = bySource(homeTasks(input({ housekeeping: [hk()] })), 'recurring-due')!;
  const later = laterNext({}, row, TODAY);
  assert.deepEqual(later[row.key], { until: '2026-10-16', detail: row.detail, count: 1 });
  assert.equal(bySource(homeTasks(input({ housekeeping: [hk()], later })), 'recurring-due'), undefined);
  assert.ok(bySource(homeTasks(input({ housekeeping: [hk()], later }, '2026-10-16')), 'recurring-due'));
  const friday = laterNext({}, row, '2026-10-16');
  assert.equal(friday[row.key].until, '2026-10-19');
  for (const day of ['2026-10-16', '2026-10-17', '2026-10-18']) {
    assert.equal(bySource(homeTasks(input({ housekeeping: [hk()], later: friday }, day)), 'recurring-due'), undefined, day);
  }
  assert.ok(bySource(homeTasks(input({ housekeeping: [hk()], later: friday }, '2026-10-19')), 'recurring-due'));
  assert.ok(bySource(homeTasks(input({ housekeeping: [hk(3)], later })), 'recurring-due'), 'a new detail shows again');
  assert.equal(nextWorkday('2026-10-16'), '2026-10-19');
});

test('the third Later moves an item up one tier and marks it escalated', () => {
  const row = bySource(homeTasks(input({ housekeeping: [hk()] })), 'recurring-due')!;
  let state = laterNext({}, row, '2026-10-13');
  state = laterNext(state, row, '2026-10-14');
  assert.equal(state[row.key].count, 2);
  assert.equal(bySource(homeTasks(input({ housekeeping: [hk()], later: state }, '2026-10-15')), 'recurring-due')?.tier, 'ooknog');
  state = laterNext(state, row, '2026-10-15');
  assert.equal(state[row.key].count, LATER_ESCALATE_COUNT);
  assert.equal(bySource(homeTasks(input({ housekeeping: [hk()], later: state }, '2026-10-15')), 'recurring-due'), undefined);
  const back = bySource(homeTasks(input({ housekeeping: [hk()], later: state }, '2026-10-16')), 'recurring-due')!;
  assert.deepEqual([back.tier, back.escalated], ['vandaag', true]);
  const pruned = laterPruned({ ...state, old: { until: '2026-09-01', detail: '', count: 1 } }, '2026-10-16');
  assert.deepEqual(Object.keys(pruned), [row.key]);
});

/* --------------------------------------------------- 10. Taak van maken */

test('a planner task made from an item hides exactly that item, while its detail is unchanged', () => {
  const base = input({ housekeeping: [hk()], purchaseCheck: 3 });
  const row = bySource(homeTasks(base), 'recurring-due')!;
  const marker = homeMarker(row);
  assert.match(marker, /^\[home:recurring-due#[0-9a-f]{8}\]$/);
  const note = `Vaste kosten boeken\n${marker}`;
  assert.deepEqual(homeMarkersOf(note), [`recurring-due#${fnv1a8(row.detail)}`]);
  assert.equal(stripHomeMarkers(note), 'Vaste kosten boeken');
  assert.equal(stripHomeMarkers(marker), null);
  const hidden = homeTasks({ ...base, taskKeys: homeMarkersOf(note) });
  assert.equal(bySource(hidden, 'recurring-due'), undefined);
  assert.ok(bySource(hidden, 'purchase-check'));
  const changed = homeTasks(input({ housekeeping: [hk(5)], purchaseCheck: 3, taskKeys: homeMarkersOf(note) }));
  assert.ok(bySource(changed, 'recurring-due'), 'new work under the same key shows again');
  assert.equal(fnv1a8(''), '811c9dc5');
});

/* --------------------------------------------------------- 11. coverage */

test('no all-clear unless every source answered', () => {
  const partial = homeTasks(input({ sources: { ...allSources, partnerfinanciering: false } }));
  assert.deepEqual([partial.complete, partial.missing, partial.allClear, partial.count], [false, ['partnerfinanciering'], false, 0]);
  const two = homeTasks(input({ sources: { ...allSources, kosten: false, verkoop: false } }));
  assert.deepEqual(two.missing, ['verkoop', 'kosten']);
  const clear = homeTasks(input());
  assert.deepEqual([clear.complete, clear.allClear, clear.total], [true, true, 0]);
  assert.equal(homeTasks(input({ loginRequests: 1 })).allClear, false);
});

test('the Te doen note and the status name the same failed sources: a missing bank is "bank", not also "kasprognose"', () => {
  const answers = (changes: Partial<Record<CoverageSource, CoverageAnswer>> = {}): Record<CoverageSource, CoverageAnswer> =>
    ({ ...Object.fromEntries(COVERAGE_ORDER.map((source) => [source, 'ready'])), ...changes }) as Record<CoverageSource, CoverageAnswer>;
  const missingOf = (parts: ReturnType<typeof coverageOf>) => homeTasks(input({ sources: parts.covered })).missing;
  /* 500 on /api/bank-balances: the headline is 'no-bank' and no other forecast source failed */
  const bank = coverageOf(answers({ bank: 'failed', kasprognose: forecastAnswer('no-bank', false) }));
  assert.deepEqual([bank.failed, missingOf(bank)], [['bank'], ['bank']]);
  /* a missing bank and failed costs: both lists read "kosten, bank, kasprognose" */
  const both = coverageOf(answers({ bank: 'failed', kosten: 'failed', kasprognose: forecastAnswer('no-bank', true) }));
  assert.deepEqual([both.failed, missingOf(both)], [['kosten', 'bank', 'kasprognose'], ['kosten', 'bank', 'kasprognose']]);
  /* partner financing: the forecast is partial */
  const partners = coverageOf(answers({ partnerfinanciering: 'failed', kasprognose: forecastAnswer('partial', true) }));
  assert.deepEqual([partners.failed, missingOf(partners)], [['partnerfinanciering', 'kasprognose'], ['partnerfinanciering', 'kasprognose']]);
  /* still loading: not covered, not failed */
  const loading = coverageOf(answers({ agenda: 'loading', kasprognose: forecastAnswer('computing', false) }));
  assert.deepEqual([loading.failed, missingOf(loading)], [[], ['agenda', 'kasprognose']]);
  assert.deepEqual(['loading', 'computing', 'ready', 'no-reading', 'partial'].map((state) => forecastAnswer(state as Parameters<typeof forecastAnswer>[0], false)),
    ['loading', 'loading', 'ready', 'ready', 'failed']);
  const clear = coverageOf(answers());
  assert.deepEqual([clear.failed, homeTasks(input({ sources: clear.covered })).allClear], [[], true]);
});

/* -------------------------------------------------------- 12. B fixture */

test('the B fixture (Thu 15 Oct 20:50): Nu 3, Vandaag 5, Ook nog 6', () => {
  const list = homeTasks(input({
    nowMs: Date.parse('2026-10-15T18:50:00Z'),
    advances: { count: 1, eur: 10000, overdueEur: 10000, first: { orderId: 47, label: 'PO-2026-047', due: '2026-10-12' } },
    containerDue: [{ orderId: 43, label: 'PO-2026-043', eur: 18250, termLabel: '70% bij aankomst' }],
    planner: [task(5, '2026-10-13', { title: 'Douanedocumenten PO-2026-014 nakijken' }), task(3, TODAY, { title: 'Prijslijst 2027 doorsturen' }),
      task(8, '2026-10-16', { title: 'Offerte Side Arendonk opvolgen' })],
    customers: [customer('WEBSITE_AANVRAAG', 'OF2026-0410', '2026-10-15T08:00:00Z'), customer('WEBSITE_AANVRAAG', 'OF2026-0411', '2026-10-14T16:00:00Z'),
      customer('VOORSTEL', 'OF2026-0391', '2026-10-14T09:12:00Z'), customer('LEVERTERMIJN', 'OF2026-0391', '2026-10-14T15:20:00Z'),
      customer('VRACHT', 'OF2026-0402', '2026-10-15T07:40:00Z')],
    vat: { paidPeriods: [], eurByDeadline: { '2026-10-25': -2184 } },
    invoicesOverdue: [invoice(1, 5200, '2026-09-30'), invoice(2, 3220, '2026-10-08')],
    loginRequests: 2,
    tight: { from: '2026-12-03', to: '2026-12-09', lowestEur: 6100, lowestDay: '2026-12-05', bufferEur: 10000 },
    housekeeping: [
      { kind: 'bank-lines', count: 13, eur: 4200, title: '13 banktransacties nog te koppelen', detail: 'laatste 3 maanden', location: { view: 'bank', tab: 'movements', link: 'unlinked' } },
      { kind: 'recurring-due', count: 2, eur: null, title: '2 vaste kosten staan klaar om te boeken', detail: 'Na het boeken staan ze bij Te betalen', location: { view: 'costs', tab: 'recurring' } },
      { kind: 'open-credits', count: 1, eur: 640.01, title: '1 creditnota met een tegoed af te handelen', detail: 'Verreken of noteer de terugbetaling', location: { view: 'incoming', kind: 'credit' } },
    ],
    purchaseCheck: 4, settlements: 1, catalog: 2,
  }));
  const nu = list.top.filter((row) => row.tier === 'nu');
  const vandaag = [...list.top, ...list.more].filter((row) => row.tier === 'vandaag');
  assert.deepEqual([nu.length, vandaag.length, list.ookNog.length, list.total, list.more.length], [3, 5, 6, 14, 1]);
  assert.deepEqual(nu.map((row) => row.source), ['advance', 'planner', 'container-due']);
  assert.equal(list.top.length, HOME_TASK_CAP);
  assert.equal(nu[0].title, 'Voorschotfactuur PO-2026-047 maken');
  assert.equal(plain(nu[0].context), '€ 10.000 gepland, nog niet gefactureerd · excl. btw · € 10.000 over datum · eerst PO-2026-047 · ma 12 okt');
  assert.equal(nu[0].chip.label, '3 d over datum');
  assert.equal(nu[2].context, 'Volgens de afspraak bij de container · 70% bij aankomst');
  const customers = bySource(list, 'customers')!;
  assert.deepEqual([customers.count, customers.tier, customers.context], [5, 'vandaag', '2 websiteaanvragen · wijziging · levertermijn · vracht']);
  assert.equal(bySource(list, 'krap'), undefined);
  assert.ok(!all(list).some((row) => row.plannerId === 8));
  assert.deepEqual(list.ookNog.map((row) => row.source).sort(),
    ['bank-lines', 'catalog', 'open-credits', 'purchase-check', 'recurring-due', 'settlement']);
});

/* --------------------------------------------------------- 13. advances */

const advances = (due: string | null, overdueEur = 0): HomeTaskInput['advances'] =>
  ({ count: 2, eur: 12000, overdueEur, first: { orderId: 47, label: 'Moederdag', due }, orderIds: [52, 47] });

test('advances: over date → Nu, within 7 days → Vandaag, later or undated → Ook nog', () => {
  const late = bySource(homeTasks(input({ advances: advances('2026-10-12', 4000) })), 'advance')!;
  assert.deepEqual([late.tier, late.chip.label, late.key, late.title], ['nu', '3 d over datum', 'advance:47,52', '2 voorschotfacturen maken']);
  assert.deepEqual(late.target, { kind: 'route', path: ['/purchasing', 47], query: { section: 'payments' } });
  const soon = bySource(homeTasks(input({ advances: advances(days(TODAY, ADVANCE_SOON_DAYS)) })), 'advance')!;
  assert.deepEqual([soon.tier, soon.chip.label], ['vandaag', 'over 7 d']);
  const later = homeTasks(input({ advances: advances(days(TODAY, ADVANCE_SOON_DAYS + 1)) }));
  assert.deepEqual([bySource(later, 'advance-later')?.tier, bySource(later, 'advance-later')?.chip.label], ['ooknog', 'over 8 d']);
  const undated = homeTasks(input({ advances: advances(null) }));
  assert.equal(bySource(undated, 'advance-later')?.tier, 'ooknog');
  assert.equal(homeTasks(input({ advances: { count: 0, eur: 0, overdueEur: 0, first: null } })).total, 0);
});

/* ---------------------------------------------------------- 14. arrival */

test('a container arriving today or tomorrow is a Vandaag row', () => {
  const arrival = (date: string) => ({ orderId: 47, label: 'Moederdag', date, sub: '2.400 st · Yunnan Pubei' });
  const list = homeTasks(input({ arrivals: [arrival(TODAY), arrival(days(TODAY, 1)), arrival(days(TODAY, 2)), arrival(days(TODAY, -1))] }));
  assert.deepEqual(all(list).map((row) => [row.key, row.title, row.chip.label]), [
    ['arrival:47:2026-10-15', 'Moederdag komt vandaag aan', 'Vandaag'],
    ['arrival:47:2026-10-16', 'Moederdag komt morgen aan', 'Morgen'],
  ]);
  assert.equal(all(list)[1].context, 'Ontvangst voorbereiden · 2.400 st · Yunnan Pubei');
});

/* --------------------------------------------------------------- 15. why */

test('"Waarom deze volgorde" is built from the thresholds', () => {
  const text = plain(whyOrderLines().join('\n'));
  assert.equal(whyOrderLines().length, 5);
  for (const part of [`€ ${OVERDUE_INVOICE_MIN_EUR.toLocaleString('nl-BE')}`, `${VAT_SHOW_DAYS} dagen`, `${VAT_NU_DAYS} dagen`,
    `${KRAP_WITHIN_DAYS} dagen`, `${CUSTOMER_WAIT_NU_WORKDAYS} werkdagen`, `eerste ${HOME_TASK_CAP}`, `${OVERDUE_INVOICE_NU_DAYS} dagen`,
    `${ADVANCE_SOON_DAYS} dagen`, `${LATER_ESCALATE_COUNT} keer Later`, `${OVERDUE_COST_DAYS} dagen open`]) {
    assert.ok(text.includes(part), part);
  }
  assert.ok(text.includes('€ 1.000') && text.includes('2 werkdagen'));
  assert.equal(OVERDUE_COST_DAYS_COPY, OVERDUE_COST_DAYS);
  assert.ok(VAT_LATE_SHOW_DAYS === 14 && OVERDUE_INVOICE_MIN_EUR === 1000);
});
