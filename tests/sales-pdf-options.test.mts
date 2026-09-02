import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeSalesPdfOptions,
  salesPdfQuery,
} from '../src/app/core/api/sales-pdf-options.ts';

test('sales PDF includes the complete customer document by default', () => {
  assert.deepEqual(normalizeSalesPdfOptions({ language: 'NL' }), {
    language: 'NL',
    includePhotos: true,
    includeProductDetails: true,
    includeLogistics: true,
    includeTerms: true,
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
    }),
    'language=EN&includePhotos=false&includeProductDetails=true&includeLogistics=false&includeTerms=false',
  );
});

test('empty language is omitted without dropping content defaults', () => {
  assert.equal(
    salesPdfQuery({ language: null }),
    'includePhotos=true&includeProductDetails=true&includeLogistics=true&includeTerms=true',
  );
});
