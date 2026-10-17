import assert from 'node:assert/strict';
import test from 'node:test';
import { barcodesInUse, matchesBarcode } from '../src/app/features/settings/barcode-usage.ts';

const product = (id: number, over: Record<string, unknown>) => ({
  id, name: `Product ${id}`, sku: `SKU-${id}`, colour: null, active: true, barcodeInner: null, barcodeOuter: null,
  packaging: { kind: 'NONE', barcode: null }, ...over,
}) as never;

test('piece, display, gift box and outer codes, sorted by code', () => {
  const rows = barcodesInUse([
    product(1, { barcodeInner: '5407009870015', barcodeOuter: '5407009870099', colour: 'Red', packaging: { kind: 'DISPLAY', barcode: '5407009871234' } }),
    product(2, { barcodeInner: '5407009870008', active: false, packaging: { kind: 'GIFT_BOX', barcode: '5407009870022' } }),
    product(3, {}),
  ]);
  assert.deepEqual(rows.map((row) => [row.code, row.kind, row.productId, row.detail, row.active]), [
    ['5407009870008', 'Stuk', 2, 'SKU-2', false],
    ['5407009870015', 'Stuk', 1, 'Red · SKU-1', true],
    ['5407009870022', 'Geschenkdoosje', 2, 'SKU-2', false],
    ['5407009870099', 'Omdoos', 1, 'Red · SKU-1', true],
    ['5407009871234', 'Display', 1, 'Red · SKU-1', true],
  ]);
});

test('a code on two products shows twice; a packaging code without packaging does not count', () => {
  const rows = barcodesInUse([
    product(1, { barcodeInner: '5407009870015' }),
    product(2, { barcodeInner: ' 5407009870015 ', packaging: { kind: 'NONE', barcode: '5407009870555' } }),
  ]);
  assert.deepEqual(rows.map((row) => [row.code, row.productId]), [['5407009870015', 1], ['5407009870015', 2]]);
  assert.equal(matchesBarcode(rows[0], 'product 1'), true);
  assert.equal(matchesBarcode(rows[0], '0015'), true);
  assert.equal(matchesBarcode(rows[0], 'omdoos'), false);
});
