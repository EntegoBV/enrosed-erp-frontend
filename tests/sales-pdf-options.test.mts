import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePackingSlipPdfOptions,
  normalizeSalesPdfOptions,
  packingSlipPdfQuery,
  salesPdfQuery,
} from '../src/app/core/api/sales-pdf-options.ts';

test('sales PDF includes the complete customer document by default', () => {
  assert.deepEqual(normalizeSalesPdfOptions({ language: 'NL' }), {
    language: 'NL',
    includePhotos: true,
    includeProductDetails: true,
    includeLogistics: true,
    includeTerms: true,
    showOuterCarton: false,
    showBarcode: false,
  });
});

test('sales PDF query keeps every manual export choice explicit', () => {
  assert.equal(
    salesPdfQuery({
      language: 'EN',
      includePhotos: false,
      includeProductDetails: true,
      includeLogistics: false,
      includeTerms: false,
      showOuterCarton: true,
      showBarcode: true,
    }),
    'language=EN&includePhotos=false&includeProductDetails=true&includeLogistics=false&includeTerms=false&showOuterCarton=true&showBarcode=true',
  );
});

test('empty language is omitted without dropping content defaults', () => {
  assert.equal(
    salesPdfQuery({ language: null }),
    'includePhotos=true&includeProductDetails=true&includeLogistics=true&includeTerms=true&showOuterCarton=false&showBarcode=false',
  );
});

test('outer carton and barcode remain independent from general product details', () => {
  const options = normalizeSalesPdfOptions({
    includeProductDetails: false,
    showOuterCarton: true,
    showBarcode: true,
  });

  assert.equal(options.includeProductDetails, false);
  assert.equal(options.showOuterCarton, true);
  assert.equal(options.showBarcode, true);
});

test('packing slip exposes only price-free packing identifiers and defaults them off', () => {
  assert.deepEqual(normalizePackingSlipPdfOptions(), {
    showOuterCarton: false,
    showBarcode: false,
  });
  assert.equal(
    packingSlipPdfQuery({ showOuterCarton: true, showBarcode: false }),
    'showOuterCarton=true&showBarcode=false',
  );
});
