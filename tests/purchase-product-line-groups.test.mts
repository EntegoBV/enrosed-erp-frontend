import assert from 'node:assert/strict';
import test from 'node:test';
import type { Category, LandedCostLine, Product } from '../src/app/core/api/models.ts';
import {
  PURCHASE_LINES_WITHOUT_CATEGORY,
  PURCHASE_LINES_WITHOUT_COLOUR,
  orderPurchaseProductLines,
  purchaseLineCategoryOptions,
  purchaseLineColourOptions,
  purchaseLineSections,
} from '../src/app/features/purchasing/purchase-product-line-groups.ts';

test('purchase composition follows category position, family and canonical variant position', () => {
  const categories = [category(20, 'Glas', 20), category(10, 'Foam', 10)];
  const products = [
    product(4, null, null, null, null, null),
    product(3, 20, 9, 'rose', 1, 'Rood'),
    product(2, 10, 7, 'foam', 2, 'Wit'),
    product(1, 10, 7, 'foam', 1, 'Blauw'),
  ];
  const lines = [line(3), line(4), line(2), line(1)];

  assert.deepEqual(
    orderPurchaseProductLines(lines, products, categories).map((item) => item.productId),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    purchaseLineSections(lines, products, categories, null, null).map((section) => ({
      label: section.label,
      ids: section.lines.map((item) => item.productId),
    })),
    [
      { label: 'Foam', ids: [1, 2] },
      { label: 'Glas', ids: [3] },
      { label: 'Zonder categorie', ids: [4] },
    ],
  );
  assert.deepEqual(purchaseLineCategoryOptions(lines, products, categories), [
    { key: 10, label: 'Foam', count: 2 },
    { key: 20, label: 'Glas', count: 1 },
    { key: PURCHASE_LINES_WITHOUT_CATEGORY, label: 'Zonder categorie', count: 1 },
  ]);
});

test('category and colour filters retain the canonical colour key and missing-colour option', () => {
  const categories = [category(10, 'Foam', 10)];
  const products = [
    product(3, 10, 7, 'foam', 3, null),
    product(2, 10, 7, 'foam', 2, 'Wit', '#ffffff'),
    product(1, 10, 7, 'foam', 1, 'Blauw', '#0000ff'),
    product(4, null, null, null, null, 'Rood'),
  ];
  const lines = [line(3), line(4), line(2), line(1)];

  assert.deepEqual(purchaseLineColourOptions(lines, products, categories, 10), [
    { key: 'blauw', label: 'Blauw', hex: '#0000ff', count: 1 },
    { key: 'wit', label: 'Wit', hex: '#ffffff', count: 1 },
    { key: PURCHASE_LINES_WITHOUT_COLOUR, label: 'Zonder kleur', hex: null, count: 1 },
  ]);
  assert.deepEqual(
    purchaseLineSections(lines, products, categories, 10, 'wit')
      .flatMap((section) => section.lines.map((item) => item.productId)),
    [2],
  );
  assert.deepEqual(
    purchaseLineSections(lines, products, categories, 10, PURCHASE_LINES_WITHOUT_COLOUR)
      .flatMap((section) => section.lines.map((item) => item.productId)),
    [3],
  );
});

function category(id: number, name: string, position: number): Category {
  return { id, name, position } as Category;
}

function product(
  id: number,
  categoryId: number | null,
  familyId: number | null,
  familyKey: string | null,
  variantPosition: number | null,
  colour: string | null,
  colourHex: string | null = null,
): Product {
  return {
    id,
    categoryId,
    familyId,
    familyKey,
    canonicalVariantKey: colour ? `${familyKey ?? 'product'}-${colour}` : null,
    variantPosition,
    variantSize: null,
    colour,
    colourHex,
    sku: `SKU-${id}`,
    name: `Product ${id}`,
  } as Product;
}

function line(productId: number): LandedCostLine {
  return { productId, productName: `Product ${productId}` } as LandedCostLine;
}
