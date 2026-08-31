import assert from 'node:assert/strict';
import test from 'node:test';
import type { Product } from '../src/app/core/api/models.ts';
import {
  orderPickerBatch,
  orderPickerProducts,
} from '../src/app/shared/product-picker-order.ts';

test('purchase picker preserves the canonical source order', () => {
  const source = [product(1, 'Rose', 'Red'), product(2, 'Rose', 'White'), product(3, 'Foam', 'Blue')];
  assert.deepEqual(orderPickerProducts(source, true).map((item) => item.id), [1, 2, 3]);
});

test('purchase batch follows source order instead of click order', () => {
  const source = [product(1, 'Rose', 'Red'), product(2, 'Rose', 'White'), product(3, 'Foam', 'Blue')];
  const clicked = [source[2], source[0], source[1]].map((item) => ({ product: item, quantity: 1 }));
  assert.deepEqual(orderPickerBatch(clicked, source, true).map((entry) => entry.product.id), [1, 2, 3]);
});

test('other pickers retain the established colour-first order', () => {
  const source = [product(1, 'Rose', null), product(2, 'Rose', 'White'), product(3, 'Foam', 'Blue')];
  assert.deepEqual(orderPickerProducts(source, false).map((item) => item.id), [3, 2, 1]);
});

function product(id: number, name: string, colour: string | null): Product {
  return { id, name, colour } as Product;
}
