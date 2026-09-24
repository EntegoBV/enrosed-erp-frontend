import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import type { Product } from '../src/app/core/api/models.ts';
import { reorderCatalogSelection } from '../src/app/features/products/catalog-product-order.ts';
import type * as SavedOrder from '../src/app/features/products/catalog-saved-order.ts';

// Resolve the Angular module's extensionless runtime import for the Node test runner.
const source = (await readFile(new URL('../src/app/features/products/catalog-saved-order.ts', import.meta.url), 'utf8'))
  .replace("'./catalog-product-order'", JSON.stringify(new URL('../src/app/features/products/catalog-product-order.ts', import.meta.url).href));
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const {
  catalogOrderChanged,
  initialCatalogOrderIds,
  normalizedCatalogOrderIds,
} = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`) as typeof SavedOrder;

const product = (id: number | null, familyId: number | null): Product => ({ id, familyId } as Product);
const catalogue = (): Product[] => [product(1, 10), product(2, 10), product(3, 20), product(4, 20)];

test('the saved shared order wins over an older browser draft', () => {
  assert.deepEqual(initialCatalogOrderIds(catalogue(), {
    revision: 7, orderedIds: [4, 3, 2, 1],
  }, [1, 2, 3, 4]), [4, 3, 2, 1]);
});

test('an explicitly saved empty order restores defaults instead of reviving the browser order', () => {
  assert.deepEqual(initialCatalogOrderIds(catalogue(), {
    revision: 2, orderedIds: [],
  }, [4, 3, 2, 1]), [1, 2, 3, 4]);
});

test('an unsaved catalogue can recover its legacy browser order', () => {
  assert.deepEqual(initialCatalogOrderIds(catalogue(), {
    revision: 0, orderedIds: [],
  }, [4, 3, 2, 1]), [4, 3, 2, 1]);
  assert.deepEqual(initialCatalogOrderIds(catalogue(), {
    revision: 0, orderedIds: [],
  }, []), [1, 2, 3, 4]);
});

test('normalization drops unavailable and duplicate IDs and keeps new variants with their family', () => {
  const products = [product(1, 10), product(2, 10), product(6, 10), product(3, 20), product(5, null), product(null, null)];
  assert.deepEqual(normalizedCatalogOrderIds(products, [3, 1, 999, 2, 3]), [3, 1, 2, 6, 5]);
});

test('deleted products and newly added families or variants do not falsely mark an order dirty', () => {
  const products = [product(1, 10), product(2, 10), product(6, 10), product(3, 20), product(5, null)];
  assert.equal(catalogOrderChanged(products, [3, 1, 2, 6, 5], [3, 1, 2, 999]), false);
  assert.equal(catalogOrderChanged(products, [3, 1, 2], [3, 1, 2, 999]), false);
});

test('both family moves and variant moves count as unsaved changes', () => {
  const products = catalogue();
  assert.equal(catalogOrderChanged(products, [3, 4, 1, 2], [1, 2, 3, 4]), true);
  assert.equal(catalogOrderChanged(products, [2, 1, 3, 4], [1, 2, 3, 4]), true);
  assert.equal(catalogOrderChanged(products, [1, 2, 3, 4], [1, 2, 3, 4]), false);
  assert.equal(catalogOrderChanged(products, [], [3, 4, 1, 2]), true);
});

test('reordering a selection preserves excluded families and variants in the full saved order', () => {
  const products = [product(1, 10), product(2, 10), product(3, 10), product(4, 20), product(5, 30), product(6, 30)];
  const selected = new Set([1, 3, 5, 6]);
  const reordered = reorderCatalogSelection(products, selected, [6, 5, 3, 1]);
  const savedIds = normalizedCatalogOrderIds(reordered, reordered.map(row => row.id!));

  assert.deepEqual(savedIds, [6, 5, 4, 3, 2, 1]);
  assert.deepEqual(initialCatalogOrderIds(products, { revision: 1, orderedIds: savedIds }, []), savedIds);
  assert.deepEqual([...selected], [1, 3, 5, 6]);
  assert.deepEqual(products.map(row => row.id), [1, 2, 3, 4, 5, 6]);
});

test('order helpers never mutate product arrays, product records, or persisted ID lists', () => {
  const products = Object.freeze(catalogue().map(row => Object.freeze(row)));
  const savedIds = Object.freeze([4, 3, 2, 1]);
  const localIds = Object.freeze([2, 1, 3, 4]);
  const saved = Object.freeze({ revision: 2, orderedIds: savedIds });

  assert.deepEqual(initialCatalogOrderIds(products, saved, localIds), [4, 3, 2, 1]);
  assert.deepEqual(normalizedCatalogOrderIds(products, savedIds), [4, 3, 2, 1]);
  assert.equal(catalogOrderChanged(products, localIds, savedIds), true);
  assert.deepEqual(products.map(row => row.id), [1, 2, 3, 4]);
  assert.deepEqual(savedIds, [4, 3, 2, 1]);
  assert.deepEqual(localIds, [2, 1, 3, 4]);
});
