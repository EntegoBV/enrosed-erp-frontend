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
    includeEnrosedCost: false,
    showFreight: false,
    includeFreight: false,
  });
});

test('hiding supplier prices keeps the independent all-in ENROSED cost', () => {
  const options = normalizePurchasePdfOptions({
    layout: 'PORTRAIT',
    audience: 'STANDARD',
    showPrices: false,
    showEur: true,
    includeEnrosedCost: true,
  });

  assert.equal(options.showPrices, false);
  assert.equal(options.showEur, false);
  assert.equal(options.includeEnrosedCost, true);
});

test('ENROSED cost is limited to the standard portrait export', () => {
  const supplier = normalizePurchasePdfOptions({
    layout: 'PORTRAIT', audience: 'SUPPLIER', includeEnrosedCost: true,
  });
  const landscape = normalizePurchasePdfOptions({
    layout: 'LANDSCAPE', audience: 'STANDARD', includeEnrosedCost: true,
  });
  const internal = normalizePurchasePdfOptions({
    layout: 'PORTRAIT', audience: 'INTERNAL', includeEnrosedCost: true,
  });
  const unspecified = normalizePurchasePdfOptions({
    layout: 'PORTRAIT', includeEnrosedCost: true,
  });
  assert.equal(supplier.includeEnrosedCost, false);
  assert.equal(landscape.includeEnrosedCost, false);
  assert.equal(internal.includeEnrosedCost, false);
  assert.equal(unspecified.includeEnrosedCost, false);
});

test('purchase PDF query uses every explicit backend option name', () => {
  const query = new URLSearchParams(purchasePdfQuery({
    layout: 'PORTRAIT',
    audience: 'STANDARD',
    showSupplier: false,
    showPrices: true,
    showEur: true,
    includeEnrosedCost: true,
  }));

  assert.deepEqual(Object.fromEntries(query), {
    showRevenue: 'false',
    layout: 'PORTRAIT',
    audience: 'STANDARD',
    showSupplier: 'false',
    showPrices: 'true',
    showEur: 'true',
    includeEnrosedCost: 'true',
    showFreight: 'false',
    includeFreight: 'false',
  });
});
