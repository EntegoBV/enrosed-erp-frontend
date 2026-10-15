import assert from 'node:assert/strict';
import test from 'node:test';
import type { CashForecast } from '../src/app/features/finance/cash-forecast.ts';
import { cashHeadline, sparkPoints } from '../src/app/features/dashboard/home-cash.ts';

const forecast = (changes: Partial<CashForecast> = {}): CashForecast => ({
  today: '2026-10-15', horizonEnd: '2027-04-15', mode: 'absolute', bufferEur: 10000, startEur: 48215,
  startAccounts: [
    { key: 'kbc', label: 'KBC zicht', eur: 41870, ageDays: 0, stale: false },
    { key: 'wise', label: 'Wise EUR', eur: 6345, ageDays: 16, stale: true },
  ],
  missingAccounts: [],
  lowestWith: { day: '2026-11-06', eur: 7940, causes: [] },
  tightWith: [
    { from: '2026-11-03', to: '2026-11-11', lowestEur: 7940, lowestDay: '2026-11-06', causes: [] },
    { from: '2027-01-20', to: '2027-01-28', lowestEur: 9100, lowestDay: '2027-01-24', causes: [] },
  ],
  days: [], ...changes,
} as CashForecast);
const ready = { bankMissing: false, warnings: [], computing: false };

test('ready: the bank, the lowest point under the buffer and the FIRST krap period', () => {
  const head = cashHeadline(forecast(), ready);
  assert.equal(head.state, 'ready');
  assert.equal(head.startEur, 48215);
  assert.deepEqual(head.lowest, { day: '2026-11-06', eur: 7940, warn: true });
  assert.deepEqual(head.tight, { from: '2026-11-03', to: '2026-11-11', lowestEur: 7940 });
  assert.equal(head.bufferEur, 10000);
  assert.deepEqual(head.accounts.map((account) => [account.label, account.eur, account.stale]), [['KBC zicht', 41870, false], ['Wise EUR', 6345, true]]);
});

test('no tight period: tight is null and a lowest above the buffer is not a warning', () => {
  const head = cashHeadline(forecast({ tightWith: [], lowestWith: { day: '2026-12-01', eur: 21000, causes: [] } }), ready);
  assert.equal(head.tight, null);
  assert.deepEqual(head.lowest, { day: '2026-12-01', eur: 21000, warn: false });
  const negative = cashHeadline(forecast({ bufferEur: -5000, lowestWith: { day: '2026-12-01', eur: -100, causes: [] } }), ready);
  assert.equal(negative.lowest?.warn, true);
});

test('relative mode (no reading) reads as no-reading, with no figures', () => {
  const head = cashHeadline(forecast({ mode: 'relative', missingAccounts: ['KBC zicht'] }), ready);
  assert.deepEqual([head.state, head.startEur, head.lowest, head.tight], ['no-reading', null, null, null]);
});

test('a failed forecast source makes it partial: the balance stays, no lowest point and no krap', () => {
  const head = cashHeadline(forecast(), { ...ready, warnings: ['vaste kosten', 'verkoop', 'vaste kosten'] });
  assert.deepEqual([head.state, head.startEur, head.lowest, head.tight], ['partial', 48215, null, null]);
  assert.deepEqual(head.warnings, ['vaste kosten', 'verkoop']);
});

test('loading, computing and no bank', () => {
  assert.equal(cashHeadline(null, ready).state, 'loading');
  const computing = cashHeadline(null, { ...ready, computing: true, startEur: 48215 });
  assert.deepEqual([computing.state, computing.startEur, computing.lowest], ['computing', 48215, null]);
  const noBank = cashHeadline(forecast(), { ...ready, bankMissing: true, warnings: ['bank'] });
  assert.deepEqual([noBank.state, noBank.startEur, noBank.tight], ['no-bank', null, null]);
});

test('the sparkline fits the box and the buffer line sits at its value', () => {
  const days = [20000, 10000, 5000, 15000, 25000].map((withEur, index) => ({ day: `2026-10-1${index}`, withEur }));
  const spark = sparkPoints(days, 100, 40, 10000);
  const points = spark.points.split(' ').map((pair) => pair.split(',').map(Number));
  assert.equal(points.length, 5);
  assert.deepEqual(points.map(([x]) => x), [0, 25, 50, 75, 100]);
  assert.ok(points.every(([, y]) => y >= 0 && y <= 40));
  assert.equal(points[4][1], 0);
  assert.equal(points[2][1], 40);
  assert.equal(spark.bufferY, 30);
  assert.deepEqual([spark.minEur, spark.maxEur], [5000, 25000]);
  const above = sparkPoints(days.slice(0, 2), 100, 40, 30000);
  assert.equal(above.bufferY, 0);
  assert.ok(above.points.split(' ').every((pair) => Number(pair.split(',')[1]) <= 40));
  assert.equal(sparkPoints([], 100, 40, 10000).points, '');
  assert.equal(sparkPoints([{ day: '2026-10-15', withEur: 100 }], 100, 40, null).points, '50,20');
});
