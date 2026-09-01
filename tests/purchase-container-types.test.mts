import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTAINER_TYPES,
  DEFAULT_PURCHASE_CONTAINER_TYPE,
  PURCHASE_CONTAINER_TYPES,
  containerCountForFill,
  containerLabel,
} from '../src/app/core/api/geo.ts';

test('offers exactly the three full-container choices when creating a purchase order', () => {
  assert.deepEqual(
    PURCHASE_CONTAINER_TYPES.map(({ value, capacityCbm }) => ({ value, capacityCbm })),
    [
      { value: 'TWENTY_GP', capacityCbm: 28 },
      { value: 'FORTY_GP', capacityCbm: 58 },
      { value: 'FORTY_HQ', capacityCbm: 68 },
    ],
  );
  assert.equal(DEFAULT_PURCHASE_CONTAINER_TYPE, 'FORTY_HQ');
  assert.equal(PURCHASE_CONTAINER_TYPES.map((type) => String(type.value)).includes('LCL'), false);
});

test('derives a safe minimum container count during a rolling backend deploy', () => {
  assert.equal(containerCountForFill({ capacityCbm: 28, usedCbm: 66.912 }), 3);
  assert.equal(containerCountForFill({
    capacityCbm: 58, usedCbm: 66.912, minimumContainerCount: 2,
  }), 2);
  assert.equal(containerCountForFill({ capacityCbm: 68, usedCbm: 0 }), 0);
});

test('keeps LCL available for existing order editing without presenting it during creation', () => {
  assert.equal(CONTAINER_TYPES.at(-1)?.value, 'LCL');
  assert.equal(containerLabel('TWENTY_GP'), "20' Standard — 28 m³");
  assert.equal(containerLabel('FORTY_GP'), "40' Standard — 58 m³");
  assert.equal(containerLabel('FORTY_HQ'), "40' High Cube — 68 m³");
});
