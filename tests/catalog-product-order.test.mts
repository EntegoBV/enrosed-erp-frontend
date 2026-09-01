import assert from 'node:assert/strict';
import test from 'node:test';
import type { Category, Product } from '../src/app/core/api/models.ts';
import { orderCatalogProducts } from '../src/app/features/products/catalog-product-order.ts';

test('catalogue order follows category, family, position, variant key and missing-value fallbacks', () => {
  const categories = [category(20, 20), category(10, 10)];
  const source = [
    product(201, 20, 30, 'orchid', 0, 'orchid-white', 'White'),
    product(105, 10, 40, 'rose', null, null, null),
    product(104, 10, 40, 'rose', 1, 'rose-red', 'Red'),
    product(101, 10, 10, 'bowl', 5, 'bowl-gold', 'Gold'),
    product(103, 10, 40, 'rose', 1, 'rose-blue', 'Blue'),
    product(999, null, null, null, null, null, null),
    product(102, 10, 40, 'rose', 0, 'rose-pink', 'Pink'),
  ];

  assert.deepEqual(
    orderCatalogProducts(source, categories).map((item) => item.id),
    [101, 102, 103, 104, 105, 201, 999],
  );
  assert.deepEqual(
    source.map((item) => item.id),
    [201, 105, 104, 101, 103, 999, 102],
  );
});

test('catalogue order uses colour, numeric size, SKU and ID as stable variant fallbacks', () => {
  const source = [
    { ...product(4, 10, 40, 'rose', 1, null, 'Red'), variantSize: '10', sku: 'SKU-10' },
    { ...product(3, 10, 40, 'rose', 1, null, 'Blue'), variantSize: '10', sku: 'SKU-10' },
    { ...product(2, 10, 40, 'rose', 1, null, 'Blue'), variantSize: '2', sku: 'SKU-20' },
    { ...product(1, 10, 40, 'rose', 1, null, 'Blue'), variantSize: '2', sku: 'SKU-2' },
  ] as Product[];

  assert.deepEqual(
    orderCatalogProducts(source, [category(10, 10)]).map((item) => item.id),
    [1, 2, 3, 4],
  );
});

function category(id: number, position: number): Category {
  return { id, position, code: `category-${id}`, name: `Category ${id}` } as Category;
}

function product(
  id: number,
  categoryId: number | null,
  familyId: number | null,
  familyKey: string | null,
  variantPosition: number | null,
  canonicalVariantKey: string | null,
  colour: string | null,
): Product {
  return {
    id,
    categoryId,
    familyId,
    familyKey,
    variantPosition,
    canonicalVariantKey,
    colour,
    name: `Product ${id}`,
    variantSize: null,
    sku: null,
  } as Product;
}
