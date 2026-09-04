import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deselectProductIds,
  groupProductsByCategory,
  productIdsBetween,
  selectProductIds,
} from '../src/app/features/products/catalog-product-selection-state.ts';

test('selecting product IDs preserves previous choices and ignores empty IDs', () => {
  const current = new Set([9]);
  const next = selectProductIds(current, [1, null, 2, undefined, 1]);

  assert.deepEqual([...next], [9, 1, 2]);
  assert.deepEqual([...current], [9]);
  assert.notEqual(next, current);
});

test('deselecting product IDs only removes the requested scope', () => {
  const current = new Set([1, 2, 9]);
  const next = deselectProductIds(current, [2, null, 3]);

  assert.deepEqual([...next], [1, 9]);
  assert.deepEqual([...current], [1, 2, 9]);
  assert.notEqual(next, current);
});

test('products are grouped in catalogue order with loose ones last', () => {
  const groups = groupProductsByCategory(
    [
      { id: 1, categoryId: 20 },
      { id: 2, categoryId: null },
      { id: 3, categoryId: 10 },
      { id: 4, categoryId: 99 },
      { id: 5, categoryId: 10 },
    ],
    [{ id: 10, name: 'Glazen stolpen' }, { id: 20, name: 'Displays' }, { id: 30, name: 'Leeg' }],
  );
  assert.deepEqual(groups.map((group) => [group.name, group.products.map((product) => product.id)]), [
    ['Glazen stolpen', [3, 5]],
    ['Displays', [1]],
    ['Zonder categorie', [2, 4]],
  ]);
});

test('a shift-click range runs both ways and skips unsaved products', () => {
  const ids = [11, 12, null, 14, 15];
  assert.deepEqual(productIdsBetween(ids, 1, 3), [12, 14]);
  assert.deepEqual(productIdsBetween(ids, 4, 0), [11, 12, 14, 15]);
  assert.deepEqual(productIdsBetween(ids, -5, 99), [11, 12, 14, 15]);
  assert.deepEqual(productIdsBetween([], 0, 1), []);
});
