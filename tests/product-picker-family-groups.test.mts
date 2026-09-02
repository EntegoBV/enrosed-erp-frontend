import assert from 'node:assert/strict';
import test from 'node:test';
import type { Category, Product, ProductFamily } from '../src/app/core/api/models.ts';
import {
  productPickerFamilySections,
  productPickerGroupOpen,
  productPickerFamilySelectionState,
  productPickerGroupSummary,
  productPickerVariantLabel,
  toggleProductPickerFamilySelection,
} from '../src/app/shared/product-picker-family-groups.ts';
import { UNCATEGORISED_PICKER_CATEGORY } from '../src/app/shared/product-picker-filters.ts';

const categories = [
  category(20, 'Glas', 20),
  category(10, 'Foam', 10),
];

test('product ranges start folded while search and explicit choices stay predictable', () => {
  assert.equal(productPickerGroupOpen('', undefined), false);
  assert.equal(productPickerGroupOpen('   ', undefined), false);
  assert.equal(productPickerGroupOpen('red', undefined), true);
  assert.equal(productPickerGroupOpen('red', false), false);
  assert.equal(productPickerGroupOpen('', true), true);
});

test('groups the purchase picker as category, product range and canonical variants', () => {
  const products = [
    product(3, 20, 8, 'Dome', 'Wit', 4, '/white.jpg'),
    product(2, 10, 7, 'Bear rose', 'Rood', 8, '/red.jpg'),
    product(1, 10, 7, 'Bear ocean', 'Blauw', 9, '/blue.jpg'),
  ];
  const families = [
    family(8, 20, 'Stolp zonder giftdoos', 2, 3, [{ productId: 3, position: 0 }]),
    family(7, 10, 'Foam beer', 1, 1, [
      { productId: 1, position: 0 },
      { productId: 2, position: 1 },
    ]),
  ];

  const sections = productPickerFamilySections(products, families, categories, {
    query: '', category: null,
  });

  assert.deepEqual(sections.map((section) => section.name), ['Foam', 'Glas']);
  assert.equal(sections[0].groups[0].name, 'Foam beer');
  assert.deepEqual(sections[0].groups[0].products.map((item) => item.id), [1, 2]);
  assert.deepEqual(sections[0].groups[0].colours.map((item) => item.name), ['Blauw', 'Rood']);
  assert.equal(sections[0].groups[0].lead.id, 1, 'featured product represents the range');
  assert.equal(sections[0].groups[0].photo, '/blue.jpg');
  assert.equal(productPickerGroupSummary(sections[0].groups[0]), '2 kleuren');
  assert.equal(productPickerVariantLabel(products[0]), 'Wit');
});

test('a family-name search keeps every colour together and a limit never cuts a range', () => {
  const products = [
    product(1, 10, 7, 'Supplier name blue', 'Blauw', 1),
    product(2, 10, 7, 'Supplier name red', 'Rood', 2),
    product(3, 10, 9, 'Other product', 'Wit', 1),
  ];
  const families = [
    family(7, 10, 'Foam beer', 2, null, [
      { productId: 1, position: 0 }, { productId: 2, position: 1 },
    ]),
    family(9, 10, 'Foam hart', 1, null, [{ productId: 3, position: 0 }]),
  ];

  const searched = productPickerFamilySections(products, families, categories, {
    query: 'foam beer', category: null,
  });
  assert.deepEqual(searched[0].groups[0].products.map((item) => item.id), [1, 2]);

  const limited = productPickerFamilySections(products, families, categories, {
    query: '', category: null, limit: 1,
  });
  assert.equal(limited.flatMap((section) => section.groups).length, 1);
  assert.equal(limited[0].groups[0].name, 'Foam hart');
  assert.deepEqual(limited[0].groups[0].products.map((item) => item.id), [3]);
});

test('caller metadata makes a supplier searchable without splitting colour families', () => {
  const products = [
    { ...product(1, 10, 7, 'Foam blauw', 'Blauw', 0), supplierId: 4 },
    { ...product(2, 10, 7, 'Foam rood', 'Rood', 1), supplierId: 4 },
    { ...product(3, 10, 9, 'Foam wit', 'Wit', 0), supplierId: 8 },
  ] as Product[];

  const sections = productPickerFamilySections(products, [], categories, {
    query: 'Yunnan Flowers',
    category: null,
    searchTextOf: (item) => item.supplierId === 4 ? 'Yunnan Flowers' : 'Other supplier',
  });

  assert.deepEqual(
    sections.flatMap((section) => section.groups).flatMap((group) => group.products.map((item) => item.id)),
    [1, 2],
  );
});

test('category filtering keeps legacy products in separate standalone groups', () => {
  const products = [
    product(1, null, null, 'Los product A', null, null),
    product(2, 999, null, 'Los product B', null, null),
    product(3, 10, 7, 'Foam rood', 'Rood', 0),
  ];
  const sections = productPickerFamilySections(products, [], categories, {
    query: '', category: UNCATEGORISED_PICKER_CATEGORY,
  });

  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, 'Zonder categorie');
  assert.deepEqual(sections[0].groups.map((group) => group.key), ['product-1', 'product-2']);
});

test('family selection adds every available colour with its own carton default and toggles all off', () => {
  const products = [
    { ...product(1, 10, 7, 'Foam blauw', 'Blauw', 0), carton: { piecesPerCarton: 6 } },
    { ...product(2, 10, 7, 'Foam rood', 'Rood', 1), carton: { piecesPerCarton: 12 } },
  ] as Product[];
  const group = productPickerFamilySections(products, [], categories, {
    query: '', category: null,
  })[0].groups[0];

  const partial = new Map([[1, { product: products[0], quantity: 18 }]]);
  assert.equal(productPickerFamilySelectionState(group, partial), 'partial');
  const all = toggleProductPickerFamilySelection(group, partial);
  assert.equal(productPickerFamilySelectionState(group, all), 'all');
  assert.equal(all.get(1)?.quantity, 18, 'an existing quantity is preserved');
  assert.equal(all.get(2)?.quantity, 12, 'a new colour starts on its own full carton');
  assert.equal(toggleProductPickerFamilySelection(group, all).size, 0);
});

function category(id: number, name: string, position: number): Category {
  return { id, name, position } as Category;
}

function family(
  id: number,
  categoryId: number,
  name: string,
  productPosition: number,
  cardFeaturedProductId: number | null,
  members: { productId: number; position: number }[],
): ProductFamily {
  return {
    id,
    categoryId,
    name,
    familyKey: `family-${id}`,
    productPosition,
    cardFeaturedProductId,
    members: members.map((member) => ({
      ...member,
      canonicalVariantKey: null,
      sku: null,
      name: '',
      colour: null,
      colourHex: null,
      size: null,
      active: true,
    })),
  } as ProductFamily;
}

function product(
  id: number,
  categoryId: number | null,
  familyId: number | null,
  name: string,
  colour: string | null,
  variantPosition: number | null,
  photo: string | null = null,
): Product {
  return {
    id,
    categoryId,
    familyId,
    familyKey: familyId === null ? null : `family-${familyId}`,
    canonicalVariantKey: colour === null ? null : `family-${familyId}-${colour}`,
    variantPosition,
    name,
    colour,
    colourHex: colour === 'Rood' ? '#a91f32' : colour === 'Blauw' ? '#123456' : null,
    variantSize: null,
    sku: `SKU-${id}`,
    describedAs: name,
    barcodeInner: null,
    barcodeOuter: null,
    carton: { piecesPerCarton: 6 },
    photos: photo === null ? [] : [{ url: photo }],
  } as Product;
}
