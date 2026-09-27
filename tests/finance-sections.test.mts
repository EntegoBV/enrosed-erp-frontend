import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FINANCE_SECTIONS, FINANCE_TABS, blankBalance, blankCost, blankRecurring, financeSection, localIsoDay, periodRange,
} from '../src/app/features/finance/finance-sections.ts';

test('today follows the local calendar, also a minute either side of midnight', () => {
  assert.equal(localIsoDay(new Date(2026, 8, 24, 23, 59)), '2026-09-24');
  assert.equal(localIsoDay(new Date(2026, 8, 25, 0, 1)), '2026-09-25');
  assert.equal(localIsoDay(new Date(2026, 11, 31, 23, 59, 59)), '2026-12-31');
  assert.equal(localIsoDay(new Date(2027, 0, 1, 0, 0)), '2027-01-01');
});

test('period presets run up to today, last year covers the whole year', () => {
  const expect = {
    '2026-01-01': { month: ['2026-01-01', '2026-01-01'], quarter: ['2026-01-01', '2026-01-01'], year: ['2026-01-01', '2026-01-01'] },
    '2026-03-31': { month: ['2026-03-01', '2026-03-31'], quarter: ['2026-01-01', '2026-03-31'], year: ['2026-01-01', '2026-03-31'] },
    '2026-04-01': { month: ['2026-04-01', '2026-04-01'], quarter: ['2026-04-01', '2026-04-01'], year: ['2026-01-01', '2026-04-01'] },
    '2026-12-31': { month: ['2026-12-01', '2026-12-31'], quarter: ['2026-10-01', '2026-12-31'], year: ['2026-01-01', '2026-12-31'] },
  } as const;
  for (const [today, periods] of Object.entries(expect)) {
    for (const [id, [from, to]] of Object.entries(periods)) {
      assert.deepEqual(periodRange(id as 'month', today), { from, to }, `${id} on ${today}`);
    }
    assert.deepEqual(periodRange('lastYear', today), { from: '2025-01-01', to: '2025-12-31' });
    assert.deepEqual(periodRange('all', today), { from: '', to: '' });
  }
});

test('blank forms use the day they are given, not a day fixed at start-up', () => {
  assert.equal(blankCost('2026-10-02').date, '2026-10-02');
  assert.equal(blankCost('2026-10-02').paidOn, null);
  assert.equal(blankRecurring('2026-10-02').startDate, '2026-10-02');
  const balance = blankBalance('2026-10-02', 'KBC Zakelijk');
  assert.deepEqual([balance.date, balance.account, balance.timeZone], ['2026-10-02', 'KBC Zakelijk', 'Europe/Brussels']);
  assert.equal(blankBalance('2026-10-02').account, '', 'a new account starts empty');
});

test('six sections, five of them on the phone tab bar, in groups', () => {
  assert.deepEqual(FINANCE_SECTIONS.map((section) => section.id), ['overview', 'open', 'incoming', 'bank', 'costs', 'analysis']);
  assert.equal(FINANCE_SECTIONS.filter((section) => section.phoneTab).length, 5);
  assert.deepEqual(FINANCE_SECTIONS.filter((section) => section.phoneTab).map((section) => section.short),
    ['Overzicht', 'Betalen', 'Ontvangen', 'Bank', 'Uitgaven']);
  assert.deepEqual([...new Set(FINANCE_SECTIONS.map((section) => section.group))], ['Vandaag', 'Geld', 'Boekhouding']);
  assert.equal(financeSection('bank').label, 'Bank');
  assert.deepEqual(FINANCE_TABS.costs.map((tab) => tab.short), ['Kosten', 'Containers', 'Vast']);
});
