import assert from 'node:assert/strict';
import test from 'node:test';
import type { Category, Product, ProductFamily, ProductFamilyMember } from '../src/app/core/api/models.ts';
import {
  productCatalogNavigation,
  productVariantNavigation,
  productVariantOptionLabel,
} from '../src/app/features/products/product-variant-navigation.ts';

test('arrows stay inside the family and follow canonical variant position', () => {
  const members = [
    member(33, 3, 'White'),
    member(11, 1, 'Red'),
    member(22, 2, 'Pink'),
  ];

  const navigation = productVariantNavigation({ members }, 22);

  assert.equal(navigation?.current.productId, 22);
  assert.equal(navigation?.previous?.productId, 11);
  assert.equal(navigation?.next?.productId, 33);
  assert.equal(navigation?.index, 1);
  assert.equal(navigation?.total, 3);
  assert.deepEqual(members.map((item) => item.productId), [33, 11, 22], 'source order stays untouched');
});

test('inactive siblings remain reachable in the ERP family sequence', () => {
  const members = [
    member(10, 1, 'Red'),
    member(20, 2, 'Old pink', false),
    member(30, 3, 'White'),
  ];

  const fromActive = productVariantNavigation({ members }, 10);
  assert.equal(fromActive?.next?.productId, 20);
  assert.equal(fromActive?.total, 3);

  const fromInactive = productVariantNavigation({ members }, 20);
  assert.equal(fromInactive?.previous?.productId, 10);
  assert.equal(fromInactive?.next?.productId, 30);
  assert.equal(fromInactive?.total, 3);
});

test('no ambiguous global fallback exists without a usable family sequence', () => {
  assert.equal(productVariantNavigation(null, 10), null);
  assert.equal(productVariantNavigation({ members: [member(10, 1, 'Red')] }, 10), null);
  assert.equal(productVariantNavigation({ members: [member(10, 1, 'Red'), member(20, 2, 'White')] }, 99), null);
});

test('first and last colour expose only the available direction', () => {
  const members = [member(10, 1, 'Red'), member(20, 2, 'White')];

  const first = productVariantNavigation({ members }, 10);
  assert.equal(first?.previous, null);
  assert.equal(first?.next?.productId, 20);

  const last = productVariantNavigation({ members }, 20);
  assert.equal(last?.previous?.productId, 10);
  assert.equal(last?.next, null);
});

test('variant labels say colour and size, then fall back safely', () => {
  assert.equal(productVariantOptionLabel({ ...member(10, 1, 'Red'), size: 'XL' }), 'Red · XL');
  assert.equal(productVariantOptionLabel({ ...member(20, 2, ''), name: 'Naamvariant' }), 'Naamvariant');
  assert.equal(productVariantOptionLabel(member(30, 3, 'Old pink', false)), 'Old pink (inactief)');
});

test('last colour continues to the next product model and then through its colours', () => {
  const categories = [{ id: 1, name: 'Rozen', position: 1 } as Category];
  const products = [
    product(11, 10, 'Model A rood', 'Red', 1),
    product(12, 10, 'Model A wit', 'White', 2),
    product(21, 20, 'Model B blauw', 'Blue', 1),
    product(22, 20, 'Model B roze', 'Pink', 2),
  ];
  const families = [
    family(20, 'Model B', 2, [member(21, 1, 'Blue'), member(22, 2, 'Pink')]),
    family(10, 'Model A', 1, [member(11, 1, 'Red'), member(12, 2, 'White')]),
  ];

  const lastColour = productCatalogNavigation(products, families, categories, 12);
  assert.equal(lastColour?.index, 1);
  assert.equal(lastColour?.total, 2);
  assert.equal(lastColour?.previous?.productId, 11);
  assert.equal(lastColour?.previousChangesProduct, false);
  assert.equal(lastColour?.next?.productId, 21);
  assert.equal(lastColour?.next?.groupName, 'Model B');
  assert.equal(lastColour?.nextChangesProduct, true);

  const firstNextProductColour = productCatalogNavigation(products, families, categories, 21);
  assert.equal(firstNextProductColour?.index, 0);
  assert.equal(firstNextProductColour?.total, 2);
  assert.equal(firstNextProductColour?.previous?.productId, 12);
  assert.equal(firstNextProductColour?.previousChangesProduct, true);
  assert.equal(firstNextProductColour?.next?.productId, 22);
  assert.equal(firstNextProductColour?.nextChangesProduct, false);
});

function member(
  productId: number,
  position: number,
  colour: string,
  active = true,
): ProductFamilyMember {
  return {
    productId,
    canonicalVariantKey: `variant-${productId}`,
    sku: `SKU-${productId}`,
    name: `Product ${productId}`,
    colour,
    colourHex: null,
    size: null,
    position,
    active,
  };
}

function product(
  id: number,
  familyId: number,
  name: string,
  colour: string,
  variantPosition: number,
): Product {
  return {
    id,
    familyId,
    familyKey: `model-${familyId}`,
    categoryId: 1,
    name,
    colour,
    colourHex: null,
    variantSize: null,
    variantPosition,
    canonicalVariantKey: `model-${familyId}-${colour.toLowerCase()}`,
    sku: `SKU-${id}`,
    active: true,
    photos: [],
  } as Product;
}

function family(
  id: number,
  name: string,
  productPosition: number,
  members: ProductFamilyMember[],
): ProductFamily {
  return {
    id,
    name,
    familyKey: `model-${id}`,
    categoryId: 1,
    productPosition,
    members,
    cardFeaturedProductId: null,
  } as ProductFamily;
}
