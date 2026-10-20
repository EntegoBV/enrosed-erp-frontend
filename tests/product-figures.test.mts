import assert from 'node:assert/strict';
import test from 'node:test';
import {
  distinctOrderCount, locationSplit, locationValues, locationStock, onderwegOrdersLabel, onderwegSummary, productMargin, stockValue, totalsByProduct,
} from '../src/app/features/products/product-figures.ts';

test('margin rounds as the desk always did', () => {
  assert.deepEqual(productMargin(3.95, 1.01), { eur: 2.94, pct: 74 });
  assert.deepEqual(productMargin(2, 2.5), { eur: -0.5, pct: -25 });
  assert.deepEqual(productMargin(0.3, 0.1), { eur: 0.2, pct: 67 });
  assert.equal(productMargin(null, 1), null);
  assert.equal(productMargin(3, null), null);
  assert.equal(productMargin(3, 0), null, 'no cost is no margin, never 100 %');
  assert.equal(productMargin(0, 1), null);
});

test('onderweg sums a series, keeps the earliest date and each order once', () => {
  const summary = onderwegSummary([
    { productId: 1, quantity: 5000, expectedArrival: '2026-12-20', orderNumbers: ['PO-2026-013'], orderIds: [13] },
    null,
    { productId: 2, quantity: 10000, expectedArrival: '2026-11-30', orderNumbers: ['PO-2026-013', 'PO-2026-015'], orderIds: [13, 15] },
    { productId: 3, quantity: 0, expectedArrival: '2026-10-01', orderNumbers: ['PO-2026-099'], orderIds: [99] },
  ]);
  assert.deepEqual(summary, { quantity: 15000, earliest: '2026-11-30', orderNumbers: ['PO-2026-013', 'PO-2026-015'], orderIds: [13, 15] });
  assert.equal(onderwegSummary([]), null);
  assert.deepEqual(onderwegSummary([{ productId: 1, quantity: 4, expectedArrival: null, orderNumbers: ['A'], orderIds: [1] }])?.earliest, null);
  assert.equal(onderwegOrdersLabel(['PO-2026-013']), 'PO-2026-013');
  assert.equal(onderwegOrdersLabel(['PO-2026-013', 'PO-2026-015', 'PO-2026-016']), 'PO-2026-013 +2');
  assert.equal(onderwegOrdersLabel([]), '');
  assert.equal(distinctOrderCount([
    { productId: 1, quantity: 1, expectedArrival: null, orderNumbers: ['A', 'B'], orderIds: [1, 2] },
    { productId: 2, quantity: 1, expectedArrival: null, orderNumbers: ['B'], orderIds: [2] },
  ]), 2);
});

test('stock value skips rows without a cost and counts them apart', () => {
  assert.deepEqual(stockValue([
    { quantity: 6000, cost: 1.01 },
    { quantity: 8, cost: 1.01 },
    { quantity: 40, cost: null },
    { quantity: 0, cost: null },
    { quantity: -2, cost: 3 },
    { quantity: 3, cost: 0.335 },
  ]), { value: 6069.09, withoutCost: 1 });
  assert.deepEqual(stockValue([]), { value: 0, withoutCost: 0 });
});

test('value per location and the group value add up to the total', () => {
  const levels = [
    { productId: 1, locationId: 10, quantity: 6000 },
    { productId: 1, locationId: 20, quantity: 8 },
    { productId: 2, locationId: 10, quantity: 100 },
    { productId: 3, locationId: 20, quantity: 5 },
  ];
  const cost = new Map<number, number | null>([[1, 1.01], [2, 2.5], [3, null]]);
  const perLocation = locationValues(levels, cost);
  assert.deepEqual([...perLocation], [[10, 6310], [20, 8.08]]);
  const totals = totalsByProduct(levels);
  assert.deepEqual([...totals], [[1, 6008], [2, 100], [3, 5]]);
  const all = stockValue([...totals].map(([id, quantity]) => ({ quantity, cost: cost.get(id) })));
  assert.equal(all.value, [...perLocation.values()].reduce((sum, value) => sum + value, 0));
  assert.equal(all.withoutCost, 1);
});

test('the split names the locations that hold stock', () => {
  assert.equal(locationSplit([{ name: 'Zaltbommel', quantity: 1960 }, { name: 'Tica Brussel', quantity: 8 }]), 'Zaltbommel 1.960 · Tica Brussel 8');
  assert.equal(locationSplit([{ name: 'Zaltbommel', quantity: 1960 }, { name: 'Tica Brussel', quantity: 0 }]), 'Zaltbommel 1.960');
});

test('loose stems keep their proportional set value at every stock location', () => {
  const levels = [{ productId: 1, locationId: 2, quantity: 7, loosePieces: 11, piecesPerUnit: 12 }];
  assert.equal(locationValues(levels, new Map([[1, 24]])).get(2), 190);
  assert.equal(totalsByProduct(levels).get(1), 95 / 12);
  assert.deepEqual(stockValue([{ quantity: 7, loosePieces: 11, piecesPerUnit: 12, cost: 24 }]), { value: 190, withoutCost: 0 });
  assert.deepEqual(stockValue([{ quantity: 0, loosePieces: 11, piecesPerUnit: 12, cost: null }]), { value: 0, withoutCost: 1 });
  assert.deepEqual(locationStock([{ ...levels[0], quantity: 0 }], [{ id: 1, active: true, landedCostEur: 24 }]).get(2),
    { products: 1, value: 22 });
  assert.equal(locationSplit([{ name: 'Tica Brussel', quantity: 7, loosePieces: 11, piecesPerUnit: 12 }]),
    'Tica Brussel 7 + 11 los');
});
