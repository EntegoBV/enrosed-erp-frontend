import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompanyCost } from '../src/app/core/api/models.ts';
import { costSummary, costsInPeriod, inclOf, monthKey, vatOf } from '../src/app/features/finance/cost-metrics.ts';

function cost(input: Partial<CompanyCost> & { amountExclEur: number }): CompanyCost {
  return { id: 1, date: '2026-10-03', category: 'BEURS', description: 'Stand', party: null, vatPct: 21, reference: null, paidOn: null, salesChannel: null, notes: null, ...input };
}

test('a cost carries its VAT and total', () => {
  assert.equal(vatOf({ amountExclEur: 1250, vatPct: 21 }), 262.5);
  assert.equal(inclOf({ amountExclEur: 1250, vatPct: 21 }), 1512.5);
  assert.equal(inclOf({ amountExclEur: 100, vatPct: null }), 100);
  assert.equal(monthKey('2026-10-03'), '2026-10');
  assert.equal(monthKey('nonsense'), '');
});

test('the summary adds up per category, month and channel and knows what is still open', () => {
  const costs = [
    cost({ id: 1, amountExclEur: 1250, category: 'TICA', salesChannel: 'TICA', date: '2026-10-03' }),
    cost({ id: 2, amountExclEur: 900, category: 'boekhouder', vatPct: 21, date: '2026-09-15', paidOn: '2026-09-20' }),
    cost({ id: 3, amountExclEur: 350, category: 'TICA', vatPct: 0, date: '2026-10-20', salesChannel: 'tica' }),
  ];
  const summary = costSummary(costs);
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
