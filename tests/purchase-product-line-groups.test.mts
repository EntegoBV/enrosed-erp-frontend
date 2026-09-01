import assert from 'node:assert/strict';
import test from 'node:test';
import type { Category, LandedCostLine, Product, ProductFamily } from '../src/app/core/api/models.ts';
import {
  PURCHASE_LINES_WITHOUT_CATEGORY,
  orderPurchaseProductLines,
  purchaseLineCategoryOptions,
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
    purchaseLineSections(lines, products, categories, [], null).map((section) => ({
      label: section.label,
      ids: section.lines.map((item) => item.productId),
      groups: section.families.map((group) => group.lines.map((item) => item.productId)),
    })),
    [
      { label: 'Foam', ids: [1, 2], groups: [[1, 2]] },
      { label: 'Glas', ids: [3], groups: [[3]] },
      { label: 'Zonder categorie', ids: [4], groups: [[4]] },
    ],
  );
  assert.deepEqual(purchaseLineCategoryOptions(lines, products, categories), [
    { key: 10, label: 'Foam', count: 2 },
    { key: 20, label: 'Glas', count: 1 },
    { key: PURCHASE_LINES_WITHOUT_CATEGORY, label: 'Zonder categorie', count: 1 },
  ]);
});

test('product lines become family cards with ordered colour variants, swatches and totals', () => {
  const categories = [category(10, 'Foam', 10)];
  const products = [
    product(3, 10, 7, 'foam', 3, null),
    product(2, 10, 7, 'foam', 2, 'Wit', '#ffffff'),
    product(1, 10, 7, 'foam', 1, 'Blauw', '#0000ff'),
    product(4, null, null, null, null, 'Rood'),
  ];
  const lines = [
    line(3, 6, 1, 0.15, 6),
    line(4, 12, 2, 0.20, 12),
    line(2, 18, 3, 0.35, 18),
    line(1, 24, 4, 0.40, 24),
  ];
  const families = [{ id: 7, name: 'Foam roos' } as ProductFamily];

  const sections = purchaseLineSections(lines, products, categories, families, 10);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].families.length, 1);
  assert.deepEqual(sections[0].families[0], {
    key: 'family-7',
    familyId: 7,
    label: 'Foam roos',
    lines: [lines[3], lines[2], lines[0]],
    swatches: [
      { key: 'blauw', label: 'Blauw', hex: '#0000ff' },
      { key: 'wit', label: 'Wit', hex: '#ffffff' },
    ],
    pieces: 48,
    cartons: 8,
    cbm: 0.9,
    totalEur: 48,
    averageUnitEur: 1,
  });
});

test('standalone products never merge and family labels work before metadata arrives', () => {
  const categories = [category(10, 'Foam', 10)];
  const products = [
    product(1, 10, 7, 'foam-rose', 1, 'Blauw'),
    product(2, 10, 7, 'foam-rose', 2, 'Wit'),
    product(3, 10, null, null, null, 'Rood'),
    product(4, 10, null, null, null, 'Wit'),
  ];
  const lines = products.map((item) => line(item.id!));

  const groups = purchaseLineSections(lines, products, categories, [], null)[0].families;
  assert.deepEqual(groups.map((group) => ({ key: group.key, label: group.label })), [
    { key: 'family-7', label: 'Foam rose' },
    { key: 'product-3', label: 'Product 3' },
    { key: 'product-4', label: 'Product 4' },
  ]);
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

function line(productId: number, quantity = 1, cartons = 1, cbm = 0.1, totalEur = 0): LandedCostLine {
  return { productId, productName: `Product ${productId}`, quantity, cartons, cbm, totalEur } as LandedCostLine;
}
