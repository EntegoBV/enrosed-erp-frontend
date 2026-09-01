import assert from 'node:assert/strict';
import test from 'node:test';
import type { Product, ProductFamily } from '../src/app/core/api/models.ts';
import {
  PRODUCT_FAMILY_SHARED_FIELDS,
  PRODUCT_FAMILY_SHARED_FIELD_GROUPS,
  productFamilySharedFieldTargets,
  productFamilySharedFieldsApplyPayload,
  productFamilySharedFieldValue,
} from '../src/app/features/products/product-family-shared-fields.ts';

test('exposes every backend field key exactly once in a stable review order', () => {
  assert.deepEqual(PRODUCT_FAMILY_SHARED_FIELDS, [
    'NAME',
    'DESCRIPTION',
    'DIMENSIONS',
    'PACKAGING',
    'CARTON',
    'PURCHASE_PRICE',
    'HS_CODE',
    'SALES_PRICE',
  ]);
  assert.equal(new Set(PRODUCT_FAMILY_SHARED_FIELDS).size, PRODUCT_FAMILY_SHARED_FIELDS.length);
  assert.deepEqual(PRODUCT_FAMILY_SHARED_FIELD_GROUPS.map((group) => group.label), [
    'Basis', 'Omdoos', 'Inkoop', 'Verkoop',
  ]);
});

test('keeps family position, excludes the source and includes recognisable inactive siblings', () => {
  const family = {
    members: [
      member(30, 3, 'Groen', true),
      member(10, 1, 'Rood', true),
      member(20, 2, 'Wit', false),
    ],
  } as ProductFamily;
  const products = [
    product(10, 'Rood', true),
    product(20, 'Warm wit', false),
    product(30, 'Groen', true),
  ];

  assert.deepEqual(productFamilySharedFieldTargets(family, products[0], products), [
    {
      productId: 20,
      name: 'Product 20',
      sku: 'SKU-20',
      colour: 'Warm wit',
      colourHex: '#FFFFFF',
      size: null,
      active: false,
    },
    {
      productId: 30,
      name: 'Product 30',
      sku: 'SKU-30',
      colour: 'Groen',
      colourHex: '#FFFFFF',
      size: null,
      active: true,
    },
  ]);
});

test('builds an ordered payload from only checked fields and target colours', () => {
  const targets = [
    { productId: 20 },
    { productId: 30 },
    { productId: 40 },
  ] as ReturnType<typeof productFamilySharedFieldTargets>;

  assert.deepEqual(productFamilySharedFieldsApplyPayload(
    7,
    targets,
    new Set([40, 20]),
    new Set(['SALES_PRICE', 'DESCRIPTION', 'CARTON']),
  ), {
    expectedFamilyId: 7,
    targetProductIds: [20, 40],
    fields: ['DESCRIPTION', 'CARTON', 'SALES_PRICE'],
  });
});

test('shows the source values that will overwrite every selected colour', () => {
  const source = {
    ...product(10, 'Rood', true),
    description: 'Korte offerteomschrijving',
    exwCurrency: 'USD',
    exwPrice: 2.15,
    extraUnitCost: 0.1,
    fixedSalesPriceEur: 8.95,
    markupPct: 35,
    carton: {
      lengthCm: 50, widthCm: 40, heightCm: 30,
      piecesPerCarton: 12, weightKg: 8.5, piecesPerHc: 9600,
    },
  } as Product;

  assert.match(productFamilySharedFieldValue('DESCRIPTION', source), /Korte offerteomschrijving/);
  assert.match(productFamilySharedFieldValue('PURCHASE_PRICE', source), /USD.*2[,.]15/);
  assert.match(productFamilySharedFieldValue('SALES_PRICE', source), /8[,.]95/);
  assert.match(productFamilySharedFieldValue('CARTON', source), /12 stuks.*9[.\s]?600\/40' HC/);
});

function member(
  productId: number,
  position: number,
  colour: string,
  active: boolean,
): ProductFamily['members'][number] {
  return {
    productId,
    position,
    colour,
    colourHex: '#EEEEEE',
    size: null,
    name: `Member ${productId}`,
    sku: `OLD-${productId}`,
    active,
    canonicalVariantKey: null,
  };
}

function product(id: number, colour: string, active: boolean): Product {
  return {
    id,
    familyId: 7,
    name: `Product ${id}`,
    sku: `SKU-${id}`,
    colour,
    colourHex: '#FFFFFF',
    variantSize: null,
    active,
  } as Product;
}
