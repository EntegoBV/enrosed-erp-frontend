import assert from 'node:assert/strict';
import test from 'node:test';
import { estimatePalletHeightCm, normalizeManualPalletType } from '../src/app/features/sales/pallet-stack.ts';

const lines = [
  { productId: 1, cartonsPerLayer: 4, palletLayers: 5, calculatedPalletHeightCm: 164 },
  { productId: 2, cartonsPerLayer: 2, palletLayers: 3, calculatedPalletHeightCm: 104 },
];

test('a measured height wins over any estimate', () => {
  assert.deepEqual(estimatePalletHeightCm({ heightCm: 180, items: [{ productId: 1, cartons: 20 }] }, lines, 14),
    { heightCm: 180, measured: true });
});

test('the estimate stacks the layers each product needs on top of the base pallet', () => {
  /* Product 1: (164 - 14) / 5 = 30 cm per layer; 6 cartons need 2 layers = 60.
     Product 2: (104 - 14) / 3 = 30 cm per layer; 3 cartons need 2 layers = 60. */
  assert.deepEqual(estimatePalletHeightCm({ heightCm: null, items: [
    { productId: 1, cartons: 6 }, { productId: 2, cartons: 3 },
  ] }, lines, 14), { heightCm: 134, measured: false });
});

test('a pallet without stackable products has no estimate', () => {
  assert.deepEqual(estimatePalletHeightCm({ heightCm: null, items: [{ productId: 9, cartons: 3 }] }, lines, 14),
    { heightCm: null, measured: false });
  assert.deepEqual(estimatePalletHeightCm({ heightCm: null, items: [] }, lines, 14),
    { heightCm: null, measured: false });
});

test('pallet type labels still normalise the historical spellings', () => {
  assert.equal(normalizeManualPalletType('blokpallet 100x120'), 'Blokpallet 120×100');
  assert.equal(normalizeManualPalletType('Europallet 120x80'), 'Europallet');
});
