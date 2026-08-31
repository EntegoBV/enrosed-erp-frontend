import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePurchasePdfOptions,
  purchasePdfQuery,
} from '../src/app/core/api/purchase-pdf-options.ts';

test('purchase PDF defaults preserve the existing output', () => {
  assert.deepEqual(normalizePurchasePdfOptions(), {
    layout: 'LANDSCAPE',
    audience: undefined,
    showRevenue: false,
    showSupplier: true,
    showPrices: true,
    showEur: false,
    showFreight: false,
    includeFreight: false,
  });
});

test('hiding product prices also hides EUR conversion and combined freight total', () => {
  const options = normalizePurchasePdfOptions({
    layout: 'PORTRAIT',
    showPrices: false,
    showEur: true,
    showFreight: true,
    includeFreight: true,
  });

  assert.equal(options.showPrices, false);
  assert.equal(options.showEur, false);
  assert.equal(options.showFreight, true);
  assert.equal(options.includeFreight, false);
});

test('freight cannot be included when its cost block is hidden', () => {
  const options = normalizePurchasePdfOptions({ showFreight: false, includeFreight: true });
  assert.equal(options.showFreight, false);
  assert.equal(options.includeFreight, false);
});

test('purchase PDF query uses every explicit backend option name', () => {
  const query = new URLSearchParams(purchasePdfQuery({
    layout: 'PORTRAIT',
    audience: 'STANDARD',
    showSupplier: false,
    showPrices: true,
    showEur: true,
    showFreight: true,
    includeFreight: true,
  }));

  assert.deepEqual(Object.fromEntries(query), {
    showRevenue: 'false',
    layout: 'PORTRAIT',
    audience: 'STANDARD',
    showSupplier: 'false',
    showPrices: 'true',
    showEur: 'true',
    showFreight: 'true',
    includeFreight: 'true',
  });
});
