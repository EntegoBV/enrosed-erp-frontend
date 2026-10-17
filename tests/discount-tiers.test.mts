import assert from 'node:assert/strict';
import test from 'node:test';
import { lineTierChanges, sortedTiers, tierChanges, tierProblem } from '../src/app/features/settings/discount-tiers.ts';

const t = (minQuantity: number, percent: number, productId: number | null = null) => ({ productId, minQuantity, percent });

test('order tiers: a changed, added or removed row counts once; row order does not', () => {
  const saved = [t(1500, 2), t(3000, 4), t(5000, 10), t(20000, 15)];
  assert.equal(tierChanges(saved, [...saved].reverse()), 0);
  assert.equal(tierChanges(saved, [t(1500, 2), t(3000, 4), t(5000, 10), t(20000, 12)]), 1);
  assert.equal(tierChanges(saved, saved.slice(0, 3)), 1);
  /* bug 5: removing the last tier makes the view dirty */
  assert.equal(tierChanges([t(1500, 2)], []), 1);
  assert.equal(tierChanges([], [t(1, 0)]), 1);
});

test('line tiers are compared per product', () => {
  const saved = [t(12, 2, 5), t(100, 4, 5), t(6, 1, 9), t(1, 3)];
  const draft = [t(12, 2, 5), t(100, 5, 5), t(6, 1, 9), t(24, 2, 11), t(1, 3)];
  assert.deepEqual([...lineTierChanges(saved, draft)], [[5, 1], [11, 1]]);
});

test('sorting and the save check', () => {
  assert.deepEqual(sortedTiers([t(3000, 4), t(1500, 2)]).map((x) => x.minQuantity), [1500, 3000]);
  assert.equal(tierProblem([t(1500, 2), t(3000, 4)]), null);
  assert.equal(tierProblem([t(0, 2)]), 'Elke drempel heeft een aantal van minstens 1.');
  assert.equal(tierProblem([t(10, 120)]), 'Een korting ligt tussen 0 en 100 %.');
  assert.equal(tierProblem([t(10, 2), t(10, 3)]), 'De drempel 10 staat er twee keer.');
});

test('percentages read and show the Belgian way', async () => {
  const { percentText, percentValue } = await import('../src/app/features/settings/discount-tiers.ts');
  assert.equal(percentText(6.5), '6,5');
  assert.equal(percentText(10), '10');
  assert.equal(percentText(null), '');
  assert.equal(percentValue('6,5'), 6.5);
  assert.equal(percentValue(' 6.5 '), 6.5);
  assert.equal(percentValue('abc'), 0);
});
