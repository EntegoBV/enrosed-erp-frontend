import assert from 'node:assert/strict';
import test from 'node:test';
import type { BankBalance, CompanyCost, RecurringCost } from '../src/app/core/api/models.ts';
import {
  addDays, bankOverview, cashOutlook, costsCsv, monthlyCostSeries, monthlyEquivalentEur, occurrencesBetween,
  largestCosts, movementsSince, recurringSummary, stepDate, topParties, upcomingRecurring, vatByQuarter, yearComparison, yearlyEur,
} from '../src/app/features/finance/finance-metrics.ts';

function definition(input: Partial<RecurringCost> = {}): RecurringCost {
  return {
    id: 1, name: 'Huur magazijn', category: 'HUUR', party: 'Immo Ham', amountExclEur: 850, vatPct: 21, salesChannel: null,
    interval: 'MONTHLY', startDate: '2026-01-31', endDate: null, nextDate: '2026-01-31', active: true, autoPaid: false,
    reference: null, notes: null, lastBookedOn: null, ...input,
  };
}

function cost(input: Partial<CompanyCost> & { date: string; amountExclEur: number }): CompanyCost {
  return { id: 1, category: 'HUUR', description: 'Huur', party: null, vatPct: 21, reference: null, paidOn: null, salesChannel: null, notes: null, ...input };
}

test('a monthly step is counted from the start, so the 31st comes back after February', () => {
  assert.equal(stepDate('2026-01-31', 'MONTHLY', 1), '2026-02-28');
  assert.equal(stepDate('2026-01-31', 'MONTHLY', 2), '2026-03-31');
  assert.equal(stepDate('2026-11-15', 'MONTHLY', 2), '2027-01-15');
  assert.equal(stepDate('2026-01-01', 'QUARTERLY', 3), '2026-10-01');
  assert.equal(stepDate('2026-01-01', 'HALF_YEARLY', 1), '2026-07-01');
  assert.equal(stepDate('2024-02-29', 'YEARLY', 1), '2025-02-28');
  assert.equal(stepDate('2026-09-01', 'WEEKLY', 2), '2026-09-15');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
});

test('occurrences inside a window honour both ends and the end date', () => {
  assert.deepEqual(occurrencesBetween({ interval: 'MONTHLY', startDate: '2026-01-31', endDate: null }, '2026-02-01', '2026-04-30'),
      ['2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(occurrencesBetween({ interval: 'MONTHLY', startDate: '2026-01-15', endDate: '2026-02-15' }, '2026-01-01', '2026-12-31'),
      ['2026-01-15', '2026-02-15']);
  assert.deepEqual(occurrencesBetween({ interval: 'WEEKLY', startDate: '2026-09-01', endDate: null }, '2026-09-10', '2026-09-01'), []);
});

test('what is coming up skips paused schedules and the periods the server already booked', () => {
  const rent = definition({ nextDate: '2026-10-31', lastBookedOn: '2026-09-30' });
  const paused = definition({ id: 2, name: 'Oude software', active: false });
  const ended = definition({ id: 3, name: 'Afgelopen', nextDate: null, lastBookedOn: '2026-03-15', endDate: '2026-03-15' });
  const accountant = definition({ id: 4, name: 'Boekhouder', amountExclEur: 200, interval: 'QUARTERLY', startDate: '2026-01-01', nextDate: '2026-10-01' });

  const rows = upcomingRecurring([rent, paused, ended, accountant], '2026-09-08', '2026-12-31');

  assert.deepEqual(rows.map((row) => `${row.date} ${row.definition.name}`),
      ['2026-10-01 Boekhouder', '2026-10-31 Huur magazijn', '2026-11-30 Huur magazijn', '2026-12-31 Huur magazijn']);
  assert.equal(rows[1].amountInclEur, 1028.5);
});

test('a definition weighs into a year and a month', () => {
  assert.equal(yearlyEur({ amountExclEur: 850, interval: 'MONTHLY' }), 10200);
  assert.equal(monthlyEquivalentEur({ amountExclEur: 300, interval: 'QUARTERLY' }), 100);
  assert.equal(monthlyEquivalentEur({ amountExclEur: 25, interval: 'WEEKLY' }), 108.33);
  const summary = recurringSummary([definition(), definition({ id: 2, amountExclEur: 120, interval: 'YEARLY', vatPct: 0 }), definition({ id: 3, active: false })]);
  assert.equal(summary.activeCount, 2);
  assert.equal(summary.pausedCount, 1);
  assert.equal(summary.yearlyExclEur, 10320);
  assert.equal(summary.monthlyExclEur, 860);
  assert.equal(summary.yearlyInclEur, 12462);
});

test('completed schedules do not inflate active recurring costs or count as paused', () => {
  const summary = recurringSummary([
    definition(),
    definition({ id: 2, name: 'Afgeronde verzekering', amountExclEur: 1200, interval: 'YEARLY', nextDate: null, lastBookedOn: '2026-01-31', endDate: '2026-01-31' }),
    definition({ id: 3, active: false, nextDate: null, lastBookedOn: '2026-01-31' }),
    definition({ id: 4, name: 'Nog niet geboekt', amountExclEur: 100, nextDate: null, lastBookedOn: null }),
  ]);
  assert.deepEqual(summary, { activeCount: 2, pausedCount: 1, endedCount: 1,
    yearlyExclEur: 11400, monthlyExclEur: 950, yearlyInclEur: 13794 });
});

test('the monthly series fills quiet months with zero, oldest first', () => {
  const series = monthlyCostSeries([
    cost({ date: '2026-07-03', amountExclEur: 100 }), cost({ date: '2026-07-20', amountExclEur: 50.5 }), cost({ date: '2026-09-01', amountExclEur: 20 }),
    cost({ date: '2026-03-01', amountExclEur: 999 }),
  ], 4, '2026-09-08');
  assert.deepEqual(series.months, ['2026-06', '2026-07', '2026-08', '2026-09']);
  assert.deepEqual(series.dates, ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']);
  assert.deepEqual(series.values, [0, 150.5, 0, 20]);
  assert.deepEqual(monthlyCostSeries([], 3, '2026-01-15').months, ['2025-11', '2025-12', '2026-01']);
});

test('a year is set against the year before, month by month', () => {
  const rows = yearComparison([
    cost({ date: '2026-02-10', amountExclEur: 100 }), cost({ date: '2025-02-10', amountExclEur: 80 }), cost({ date: '2025-12-31', amountExclEur: 5 }),
  ], 2026);
  assert.equal(rows.length, 12);
  assert.deepEqual(rows[1], { month: 2, thisYearEur: 100, lastYearEur: 80 });
  assert.deepEqual(rows[11], { month: 12, thisYearEur: 0, lastYearEur: 5 });
});

test('the bank overview keeps the newest reading per account and totals them over time', () => {
  const readings: BankBalance[] = [
    { id: 1, account: 'KBC zicht', date: '2026-09-01', balanceEur: 10000, notes: null },
    { id: 2, account: 'KBC spaar', date: '2026-09-01', balanceEur: 25000, notes: null },
    { id: 3, account: 'KBC zicht', date: '2026-09-08', balanceEur: 8500.5, notes: null },
  ];
  const overview = bankOverview(readings);
  assert.equal(overview.totalEur, 33500.5);
  assert.equal(overview.asOf, '2026-09-08');
  assert.deepEqual(overview.accounts.map((row) => [row.account, row.balanceEur, row.deltaEur, row.readings]),
      [['KBC spaar', 25000, null, 1], ['KBC zicht', 8500.5, -1499.5, 2]]);
  assert.deepEqual(overview.series, { dates: ['2026-09-01', '2026-09-08'], values: [35000, 33500.5] });
  assert.deepEqual(bankOverview([]), { accounts: [], totalEur: 0, asOf: null, series: { dates: [], values: [] } });
});

test('bank history merges account case, whitespace and formatted IBAN aliases without doubling money', () => {
  const overview = bankOverview([
    { id: 1, account: '  Kbc   zicht ', date: '2026-09-01', balanceEur: 1000, notes: null },
    { id: 2, account: 'BE68539007547034', date: '2026-09-01', balanceEur: 400, notes: null },
    { id: 3, account: 'KBC zicht', date: '2026-09-02', balanceEur: 900, notes: null },
    { id: 4, account: ' BE68 5390 0754 7034 ', date: '2026-09-02', balanceEur: 500, notes: null },
    { id: 5, account: 'ING', date: '2026-09-02', balanceEur: 200, notes: null },
    { id: 6, account: '   ', date: '2026-09-02', balanceEur: 999, notes: null },
  ]);
  assert.equal(overview.totalEur, 1600);
  assert.deepEqual(overview.accounts.map(row => [row.account, row.balanceEur, row.previousEur, row.deltaEur, row.readings]),
    [['KBC zicht', 900, 1000, -100, 2], ['BE68 5390 0754 7034', 500, 400, 100, 2], ['ING', 200, null, null, 1]]);
  assert.deepEqual(overview.series, { dates: ['2026-09-01', '2026-09-02'], values: [1400, 1600] });
});

test('the cash outlook takes the open and coming costs off the bank and adds the open invoices', () => {
  assert.equal(cashOutlook(33500.5, 1512.51, 2057, 4200).expectedEur, 34130.99);
  assert.equal(cashOutlook(0, Number.NaN, 10, 0).expectedEur, -10);
});

test('the CSV uses semicolons and a decimal comma and quotes what would break a cell', () => {
  const csv = costsCsv([
    cost({ id: 2, date: '2026-09-05', amountExclEur: 1250, party: 'TICA; Trends & Trade', reference: 'F "77"', recurringCostId: 4 }),
    cost({ id: 1, date: '2026-09-01', amountExclEur: 10, vatPct: 0 }),
  ], (code) => code === 'HUUR' ? 'Huur & magazijn' : code);
  const lines = csv.split('\r\n');
  assert.equal(lines[0].split(';')[5], 'Bedrag excl. btw');
  assert.equal(lines[1], '2026-09-01;Huur & magazijn;Huur;;;10,00;0,00;0,00;10,00;;;nee;');
  assert.equal(lines[2], '2026-09-05;Huur & magazijn;Huur;"TICA; Trends & Trade";"F ""77""";1250,00;21,00;262,50;1512,50;;;ja;');
});

test('the bank rolls forward with what moved after the last reading, and not before it', () => {
  const costs = [
    cost({ id: 1, date: '2026-09-02', amountExclEur: 100, paidOn: '2026-09-02', description: 'Boekhouder', party: 'Accountant BV' }),
    cost({ id: 2, date: '2026-09-05', amountExclEur: 200, paidOn: '2026-09-09', description: 'Huur', vatPct: 0 }),
    cost({ id: 3, date: '2026-09-06', amountExclEur: 50, paidOn: null, description: 'Open' }),
  ];
  const payments = [
    { paidOn: '2026-09-10', amountEur: 5000, orderNumber: 'PO-2026-005', orderAlias: 'Rozen', label: 'Saldo' },
    { paidOn: '2026-09-01', amountEur: 9999, orderNumber: 'PO-2026-004', label: null },
  ];
  const invoices = [{ date: '2026-09-12', number: 'F-2026-0003', customer: 'Bloemen BV', amountEur: 1210 }];

  const moves = movementsSince('2026-09-08', 12500, costs, payments, invoices);

  assert.deepEqual(moves.rows.map((row) => `${row.date} ${row.label} ${row.amountEur}`),
      ['2026-09-12 Factuur F-2026-0003 1210', '2026-09-10 Inkoop PO-2026-005 -5000', '2026-09-09 Huur -200']);
  assert.equal(moves.rows[1].detail, 'Rozen · Saldo');
  assert.equal(moves.outEur, 5200);
  assert.equal(moves.inEur, 1210);
  assert.equal(moves.netEur, -3990);
  assert.equal(moves.currentEur, 8510);
  const none = movementsSince(null, 0, costs, payments, invoices);
  assert.equal(none.rows.length, 0, 'without a reading nothing rolls');
  assert.equal(none.currentEur, 0);
});

test('parties, largest costs and quarters read from the same list', () => {
  const costs = [
    cost({ id: 1, date: '2026-01-10', amountExclEur: 300, party: 'TICA' }),
    cost({ id: 2, date: '2026-04-10', amountExclEur: 100, party: 'TICA', vatPct: 6 }),
    cost({ id: 3, date: '2026-04-20', amountExclEur: 500, party: null }),
    cost({ id: 4, date: '2025-12-31', amountExclEur: 900, party: 'Vorig jaar' }),
  ];
  assert.deepEqual(topParties(costs, 2).map((row) => [row.party, row.exclEur, row.sharePct]), [['Vorig jaar', 900, 50], ['Zonder naam', 500, 27.78]]);
  assert.deepEqual(largestCosts(costs, 2).map((row) => row.id), [4, 3]);
  const quarters = vatByQuarter(costs, 2026);
  assert.deepEqual(quarters.map((row) => [row.label, row.count, row.exclEur, row.vatEur, row.inclEur]),
      [['Q1', 1, 300, 63, 363], ['Q2', 2, 600, 111, 711], ['Q3', 0, 0, 0, 0], ['Q4', 0, 0, 0, 0]]);
});
