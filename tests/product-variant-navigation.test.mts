import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductFamilyMember } from '../src/app/core/api/models.ts';
import {
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
