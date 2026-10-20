import assert from 'node:assert/strict';
import test from 'node:test';
import { withAllLocations, fractionalDisplayCount } from '../src/app/features/analyses/analyses-stock.ts';

test('stock counts every location; a product without level rows keeps its own figure', () => {
  const products = [{ id: 1, stockQuantity: 420 }, { id: 2, stockQuantity: 1600 }, { id: 3, stockQuantity: 7 }, { id: null, stockQuantity: 2 }];
  const levels = [{ productId: 1, locationId: 1, quantity: 420 }, { productId: 1, locationId: 2, quantity: 30 },
    { productId: 2, locationId: 1, quantity: 1600 }, { productId: 2, locationId: 2, quantity: 120 }, { productId: 9, locationId: 1, quantity: 5 }];
  const result = withAllLocations(products, levels);
  assert.deepEqual(result.map((product) => product.stockQuantity), [450, 1720, 7, 2]);
  assert.equal(result[2], products[2], 'untouched products are the same objects');
  assert.equal(products[0].stockQuantity, 420, 'the input is not changed');
});

test('analyses value remaining stems as an exact share of the display cost', () => {
  const products = [{ id: 1, stockQuantity: 0, landedCostEur: 24 }];
  const result = withAllLocations(products, [{ productId: 1, locationId: 2, quantity: 7, loosePieces: 11, piecesPerUnit: 12 }]);
  assert.equal(result[0].stockQuantity, 95 / 12);
  assert.equal(result[0].stockQuantity * result[0].landedCostEur, 190);
  assert.equal(products[0].stockQuantity, 0);
});

test('opened displays are described as complete displays and exact loose stems', () => {
  const stem = { one: 'steel', other: 'stelen' };
  assert.equal(fractionalDisplayCount(95 / 12, 12, stem), '7 displays + 11 losse stelen');
  assert.equal(fractionalDisplayCount(13 / 12, 12, stem), '1 display + 1 losse steel');
  assert.equal(fractionalDisplayCount(11 / 12, 12, stem), '11 losse stelen');
  assert.equal(fractionalDisplayCount(-1 / 12, 12, stem), '−1 losse steel');
  assert.equal(fractionalDisplayCount(-95 / 12, 12, stem), '−7 displays − 11 losse stelen');
});

test('whole counts and nonphysical fractions retain their existing unit formatter', () => {
  const stem = { one: 'steel', other: 'stelen' };
  assert.equal(fractionalDisplayCount(8, 12, stem), null);
  assert.equal(fractionalDisplayCount(0, 12, stem), null);
  assert.equal(fractionalDisplayCount(7.123, 12, stem), null, 'a sales-rate fraction is not rounded to invented stems');
  assert.equal(fractionalDisplayCount(95, 1, stem), null);
  assert.equal(fractionalDisplayCount(95, null, stem), null);
});
