import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  Category,
  LandedCostLine,
  Product,
  ProductFamily,
} from '../src/app/core/api/models.ts';
import { COLOUR_SWATCHES } from '../src/app/core/api/geo.ts';
import {
  purchaseColourHex,
  purchaseLineSections,
} from '../src/app/features/purchasing/purchase-line-display.ts';

const categories = [
  category(2, 'Foam', 1),
  category(1, 'Stolpen', 0),
];
const products = [
  product(1, 'Foam roos blauw', 2, 20, 'foam-rose', 'Blauw', 1, '/foam-blue.jpg'),
  product(2, 'Stolp wit', 1, 10, 'dome', 'Wit', 1, '/dome-white.jpg'),
  product(3, 'Foam roos rood', 2, 20, 'foam-rose', 'Rood', 0, '/foam-red.jpg'),
  product(4, 'Stolp zonder kleur', 1, 10, 'dome', null, 0),
];
const families = [
  family(20, 'Foam Rose', 2, 2, 3, [3, 1]),
  family(10, 'Rose in Glass Dome', 1, 1, 2, [4, 2]),
];
const lines = [line(1, 120, 12, 1.2, 180), line(2, 60, 6, .6, 150),
  line(4, 40, 4, .4, 90), line(3, 80, 8, .8, 160)];

test('purchase view builds category, model and canonical variant hierarchy', () => {
  const sections = purchaseLineSections(lines, products, categories, families, COLOUR_SWATCHES);

  assert.deepEqual(sections.map((section) => section.name), ['Stolpen', 'Foam']);
  assert.deepEqual(sections.map((section) => section.lineCount), [2, 2]);
  assert.deepEqual(sections[0].groups.map((group) => group.key), ['family:10']);
  assert.equal(sections[0].groups[0].name, 'Rose in Glass Dome');
  assert.deepEqual(
    sections[0].groups[0].entries.map((entry) => entry.line.productId),
    [4, 2],
  );
  assert.deepEqual(
    sections[1].groups[0].entries.map((entry) => entry.line.productId),
    [3, 1],
  );
  assert.deepEqual(
    sections.flatMap((section) => section.groups)
      .flatMap((group) => group.entries.map((entry) => entry.displayIndex)),
    [1, 2, 3, 4],
  );
});

test('same colours in different product models never merge', () => {
  const blueDome = product(5, 'Stolp blauw', 1, 10, 'dome', 'Blauw', 2);
  const secondBlueFamily = product(6, 'Foam bowl blauw', 2, 30, 'foam-bowl', 'Blauw', 0);
  const sections = purchaseLineSections(
    [line(1), line(5), line(6)],
    [...products, blueDome, secondBlueFamily],
    categories,
    [...families, family(30, 'Foam Bowl', 2, 3, 6, [6])],
    COLOUR_SWATCHES,
  );

  assert.deepEqual(
    sections.flatMap((section) => section.groups.map((group) => ({
      key: group.key,
      products: group.entries.map((entry) => entry.line.productId),
    }))),
    [
      { key: 'family:10', products: [5] },
      { key: 'family:20', products: [1] },
      { key: 'family:30', products: [6] },
    ],
  );
});

test('family header uses canonical name, featured photo, swatches and aggregate totals', () => {
  const foam = purchaseLineSections(lines, products, categories, families, COLOUR_SWATCHES)[1].groups[0];

  assert.equal(foam.name, 'Foam Rose');
  assert.equal(foam.photoUrl, '/foam-red.jpg');
  assert.deepEqual(foam.swatches, [
    { label: 'Rood', hex: '#A91F32' },
    { label: 'Blauw', hex: '#2F5D9E' },
  ]);
  assert.deepEqual(foam.totals, {
    pieces: 200,
    cartons: 20,
    cbm: 2,
    goodsEur: 280,
    totalEur: 340,
    averageUnitEur: 1.7,
  });
});

test('a product without family stays a standalone single-card group', () => {
  const loose = product(9, 'Los decoratiestuk', 2, null, null, 'Goud', null, '/loose.jpg');
  const section = purchaseLineSections(
    [line(9, 5, 1, .1, 25)],
    [...products, loose],
    categories,
    families,
    COLOUR_SWATCHES,
  )[0];

  assert.equal(section.groups.length, 1);
  assert.equal(section.groups[0].key, 'product:9');
  assert.equal(section.groups[0].standalone, true);
  assert.equal(section.groups[0].name, 'Los decoratiestuk');
  assert.deepEqual(section.groups[0].entries.map((entry) => entry.line.productId), [9]);
});

test('missing family metadata falls back without losing family grouping', () => {
  const sections = purchaseLineSections(
    [line(1), line(3)],
    products,
    categories,
    [],
    COLOUR_SWATCHES,
  );

  assert.equal(sections[0].groups.length, 1);
  assert.equal(sections[0].groups[0].key, 'family:20');
  assert.equal(sections[0].groups[0].name, 'Foam rose');
  assert.deepEqual(sections[0].groups[0].entries.map((entry) => entry.line.productId), [3, 1]);
});

test('colour swatches match labels case-insensitively and explicit colour wins', () => {
  assert.equal(purchaseColourHex({ ...products[0], colour: 'blauw' }, COLOUR_SWATCHES), '#2F5D9E');
  assert.equal(
    purchaseColourHex({ ...products[0], colourHex: '#123456' }, COLOUR_SWATCHES),
    '#123456',
  );
});

function category(id: number, name: string, position: number): Category {
  return { id, name, position } as Category;
}

function product(
  id: number,
  name: string,
  categoryId: number,
  familyId: number | null,
  familyKey: string | null,
  colour: string | null,
  variantPosition: number | null,
  photoUrl: string | null = null,
): Product {
  return {
    id,
    name,
    categoryId,
    familyId,
    familyKey,
    canonicalVariantKey: colour && familyKey ? `${familyKey}-${colour.toLocaleLowerCase()}` : null,
    colour,
    colourHex: null,
    variantPosition,
    variantSize: null,
    sku: `SKU-${id}`,
    photos: photoUrl ? [{ url: photoUrl }] : [],
  } as Product;
}

function family(
  id: number,
  name: string,
  categoryId: number,
  productPosition: number,
  featuredProductId: number,
  productIds: number[],
): ProductFamily {
  return {
    id,
    name,
    categoryId,
    productPosition,
    cardFeaturedProductId: featuredProductId,
    images: [],
    members: productIds.map((productId, position) => ({ productId, position })),
  } as ProductFamily;
}

function line(
  productId: number,
  quantity = 1,
  cartons = 1,
  cbm = 1,
  totalEur = 1,
): LandedCostLine {
  return {
    productId,
    productName: products.find((item) => item.id === productId)?.name ?? `Product ${productId}`,
    quantity,
    cartons,
    cbm,
    goodsEur: totalEur - 30,
    totalEur,
  } as LandedCostLine;
}
