import assert from 'node:assert/strict';
import test from 'node:test';
import { locationStock, locationValues } from '../src/app/features/products/product-figures.ts';

test('Voorraadlocaties counts and values a location exactly as /stock does', () => {
  const levels = [
    { productId: 1, locationId: 10, quantity: 3 },
    { productId: 2, locationId: 10, quantity: 7 },
    { productId: 3, locationId: 10, quantity: 100 },
    { productId: 1, locationId: 20, quantity: 1 },
    { productId: 2, locationId: 20, quantity: 0 },
  ];
  const products = [
    { id: 1, active: true, landedCostEur: 0.335 },
    { id: 2, active: true, landedCostEur: null },
    { id: 3, active: false, landedCostEur: 5 },
  ];
  const lines = locationStock(levels, products);
  /* The inactive product 3 is not counted and not valued (on /stock it has no row). */
  assert.deepEqual(lines.get(10), { products: 2, value: 1.01 });
  assert.deepEqual(lines.get(20), { products: 1, value: 0.34 });
  /* Rounded per level in cents, the same figure as /stock's location cell. */
  const active = products.filter((product) => product.active);
  const stock = locationValues(levels.filter((level) => active.some((product) => product.id === level.productId)),
    new Map(active.map((product) => [product.id, product.landedCostEur])));
  assert.equal(lines.get(10)?.value, stock.get(10));
  assert.equal(lines.get(20)?.value, stock.get(20));
});

test('a location without stock of an active product has no line entry (it reads "0 producten")', () => {
  const lines = locationStock([{ productId: 3, locationId: 30, quantity: 5 }], [{ id: 3, active: false, landedCostEur: 2 }]);
  assert.equal(lines.has(30), false);
});
