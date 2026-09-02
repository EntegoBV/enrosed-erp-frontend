import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePurchasePdfOptions,
  purchasePdfQuery,
} from '../src/app/core/api/purchase-pdf-options.ts';

test('fixed landscape preset preserves the existing output', () => {
  assert.deepEqual(normalizePurchasePdfOptions(), {
    layout: 'LANDSCAPE',
    audience: undefined,
    showRevenue: false,
    showSupplier: true,
    showPrices: true,
    includeUnitPrice: true,
    showEur: false,
    eurOnly: false,
    includeEnrosedCost: false,
    includeEnrosedUnitCost: false,
    showPaymentTerms: false,
    showFreight: false,
    includeFreight: false,
  });
});

test('every optional standard portrait field starts hidden', () => {
  const options = normalizePurchasePdfOptions({
    layout: 'PORTRAIT',
    audience: 'STANDARD',
  });

  assert.deepEqual(options, {
    layout: 'PORTRAIT',
    audience: 'STANDARD',
    showRevenue: false,
    showSupplier: false,
    showPrices: false,
    includeUnitPrice: false,
    showEur: false,
    eurOnly: false,
    includeEnrosedCost: false,
    includeEnrosedUnitCost: false,
    showPaymentTerms: false,
    showFreight: false,
    includeFreight: false,
  });
});

test('price details stay hidden until prices are enabled', () => {
  const hidden = normalizePurchasePdfOptions({
    layout: 'PORTRAIT',
    audience: 'STANDARD',
    showPrices: false,
    includeUnitPrice: true,
    showEur: true,
    eurOnly: true,
  });
  assert.equal(hidden.includeUnitPrice, false);
  assert.equal(hidden.showEur, false);
  assert.equal(hidden.eurOnly, false);

  const eurOnly = normalizePurchasePdfOptions({
    layout: 'PORTRAIT',
    audience: 'STANDARD',
    showPrices: true,
    includeUnitPrice: true,
    showEur: true,
    eurOnly: true,
  });
  assert.equal(eurOnly.includeUnitPrice, true);
  assert.equal(eurOnly.showEur, false);
  assert.equal(eurOnly.eurOnly, true);
});

test('line cost, unit cost and payment terms are independent portrait options', () => {
  const options = normalizePurchasePdfOptions({
    layout: 'PORTRAIT',
    audience: 'STANDARD',
    includeEnrosedCost: true,
    includeEnrosedUnitCost: true,
    showPaymentTerms: true,
  });

  assert.equal(options.showPrices, false);
  assert.equal(options.includeEnrosedCost, true);
  assert.equal(options.includeEnrosedUnitCost, true);
  assert.equal(options.showPaymentTerms, true);
});

test('custom portrait switches cannot leak into fixed exports', () => {
  for (const preset of [
    { layout: 'LANDSCAPE', audience: 'STANDARD' },
    { layout: 'PORTRAIT', audience: 'SUPPLIER' },
    { layout: 'PORTRAIT', audience: 'INTERNAL' },
  ] as const) {
    const options = normalizePurchasePdfOptions({
      ...preset,
      includeEnrosedCost: true,
      includeEnrosedUnitCost: true,
      showPaymentTerms: true,
      eurOnly: true,
    });
    assert.equal(options.includeEnrosedCost, false);
    assert.equal(options.includeEnrosedUnitCost, false);
    assert.equal(options.showPaymentTerms, false);
    assert.equal(options.eurOnly, false);
  }
});

test('purchase PDF query serializes every explicit backend option', () => {
  const query = new URLSearchParams(purchasePdfQuery({
    layout: 'PORTRAIT',
    audience: 'STANDARD',
    showSupplier: true,
    showPrices: true,
    includeUnitPrice: true,
    showEur: true,
    includeEnrosedCost: true,
    includeEnrosedUnitCost: true,
    showPaymentTerms: true,
  }));

  assert.deepEqual(Object.fromEntries(query), {
    showRevenue: 'false',
    layout: 'PORTRAIT',
    audience: 'STANDARD',
    showSupplier: 'true',
    showPrices: 'true',
    includeUnitPrice: 'true',
    showEur: 'true',
    eurOnly: 'false',
    includeEnrosedCost: 'true',
    includeEnrosedUnitCost: 'true',
    showPaymentTerms: 'true',
    showFreight: 'false',
    includeFreight: 'false',
  });
});
