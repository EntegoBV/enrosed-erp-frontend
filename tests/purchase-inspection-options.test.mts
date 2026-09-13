import assert from 'node:assert/strict';
import test from 'node:test';
import { purchaseInspectionQuery } from '../src/app/core/api/purchase-inspection-options.ts';

test('inspection default is English with product references and supplier agreements', () => {
  assert.deepEqual(Object.fromEntries(new URLSearchParams(purchaseInspectionQuery())), {
    language: 'EN', includePhotos: 'true', includeSupplierAgreements: 'true',
  });
});

test('product references and agreement photos are independently selectable', () => {
  for (const includePhotos of [false, true]) {
    for (const includeSupplierAgreements of [false, true]) {
      assert.deepEqual(Object.fromEntries(new URLSearchParams(purchaseInspectionQuery({
        language: 'NL', includePhotos, includeSupplierAgreements,
      }))), {
        language: 'NL', includePhotos: String(includePhotos),
        includeSupplierAgreements: String(includeSupplierAgreements),
      });
    }
  }
});

test('an inspection request cannot inherit commercial export options', () => {
  const commercialSelection = {
    language: 'EN' as const, showPrices: true, showRevenue: true,
    showPaymentTerms: true, includeEnrosedCost: true,
  };
  assert.deepEqual([...new URLSearchParams(purchaseInspectionQuery(commercialSelection)).keys()], [
    'language', 'includePhotos', 'includeSupplierAgreements',
  ]);
});
