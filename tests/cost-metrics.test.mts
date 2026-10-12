import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompanyCost } from '../src/app/core/api/models.ts';
import { costSummary, costsInPeriod, monthKey } from '../src/app/features/finance/cost-metrics.ts';
import { COST_MONEY } from '../src/app/features/finance/finance-metrics.ts';

function cost(input: Partial<CompanyCost> & { amountExclEur: number }): CompanyCost {
  return { id: 1, date: '2026-10-03', category: 'BEURS', description: 'Stand', party: null, vatPct: 21, reference: null, paidOn: null, salesChannel: null, notes: null,
    vatRegime: 'BE', vatRegimeConfirmed: true, ...input } as CompanyCost;
}

test('the month key', () => {
  assert.equal(monthKey('2026-10-03'), '2026-10');
  assert.equal(monthKey('nonsense'), '');
});

test('the money rule comes in from finance-metrics: an entered inclusive total stays € 100,00', () => {
  const summary = costSummary([cost({ id: 1, amountExclEur: 82.64, amountInclEur: 100 }), cost({ id: 2, amountExclEur: 10, vatPct: 0 })], COST_MONEY);
  assert.deepEqual([summary.exclEur, summary.vatEur, summary.inclEur, summary.unpaidEur], [92.64, 17.36, 110, 110]);
});

test('the summary counts what the regime says: reverse charge, non-deductible VAT, import VAT apart, remainders open', () => {
  const summary = costSummary([
    cost({ id: 1, amountExclEur: 100, vatRegime: 'EU_SERVICES' }),
    cost({ id: 2, amountExclEur: 100, vatDeductiblePct: 0, paidOn: '2026-10-05', openEur: 0 }),
    cost({ id: 3, amountExclEur: 0, vatPct: null, amountInclEur: 500, vatRegime: 'IMPORT_VAT_PAID' }),
    cost({ id: 4, amountExclEur: 200, openEur: 42 }),
  ], COST_MONEY);
  assert.equal(summary.exclEur, 100 + 121 + 0 + 200, 'expense: excl. plus the VAT that stays a cost; import VAT is none');
  assert.equal(summary.vatEur, 21 + 21 + 500 + 42, 'what the return shows');
  assert.equal(summary.inclEur, 100 + 121 + 500 + 242, 'what the bank pays');
  assert.equal(summary.importVatEur, 500);
  assert.deepEqual([summary.unpaidCount, summary.unpaidEur], [3, 100 + 500 + 42], 'open remainders, never the paid date');
  assert.deepEqual(summary.byCategory.map((row) => [row.category, row.exclEur]), [['BEURS', 421]]);
});

test('the summary adds up per category, month and channel and knows what is still open', () => {
  const costs = [
    cost({ id: 1, amountExclEur: 1250, category: 'TICA', salesChannel: 'TICA', date: '2026-10-03' }),
    cost({ id: 2, amountExclEur: 900, category: 'boekhouder', vatPct: 21, date: '2026-09-15', paidOn: '2026-09-20' }),
    cost({ id: 3, amountExclEur: 350, category: 'TICA', vatPct: 0, date: '2026-10-20', salesChannel: 'tica' }),
  ];
  const summary = costSummary(costs, COST_MONEY);
  assert.equal(summary.count, 3);
  assert.equal(summary.exclEur, 2500);
  assert.equal(summary.vatEur, 262.5 + 189);
  assert.equal(summary.inclEur, 2951.5);
  assert.equal(summary.unpaidCount, 2);
  assert.equal(summary.unpaidEur, 1512.5 + 350);
  assert.deepEqual(summary.byCategory.map((row) => [row.category, row.exclEur, row.sharePct]), [['TICA', 1600, 64], ['BOEKHOUDER', 900, 36]]);
  assert.deepEqual(summary.byMonth.map((row) => [row.month, row.exclEur]), [['2026-10', 1600], ['2026-09', 900]]);
  assert.deepEqual(summary.byChannel.map((row) => [row.channel, row.exclEur]), [['TICA', 1600], [null, 900]]);
  assert.equal(costsInPeriod(costs, '2026-10-01', '2026-10-31').length, 2);
  assert.equal(costsInPeriod(costs, null, '2026-09-30').length, 1);
});
