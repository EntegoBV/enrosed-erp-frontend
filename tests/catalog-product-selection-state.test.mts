import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deselectProductIds,
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
