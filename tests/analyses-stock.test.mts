import assert from 'node:assert/strict';
import test from 'node:test';
import { withAllLocations } from '../src/app/features/analyses/analyses-stock.ts';

test('stock counts every location; a product without level rows keeps its own figure', () => {
  const products = [{ id: 1, stockQuantity: 420 }, { id: 2, stockQuantity: 1600 }, { id: 3, stockQuantity: 7 }, { id: null, stockQuantity: 2 }];
  const levels = [{ productId: 1, locationId: 1, quantity: 420 }, { productId: 1, locationId: 2, quantity: 30 },
    { productId: 2, locationId: 1, quantity: 1600 }, { productId: 2, locationId: 2, quantity: 120 }, { productId: 9, locationId: 1, quantity: 5 }];
  const result = withAllLocations(products, levels);
  assert.deepEqual(result.map((product) => product.stockQuantity), [450, 1720, 7, 2]);
  assert.equal(result[2], products[2], 'untouched products are the same objects');
  assert.equal(products[0].stockQuantity, 420, 'the input is not changed');
});
