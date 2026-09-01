import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductSupplierAgreementPhoto } from '../src/app/core/api/models.ts';
import {
  moveSupplierAgreementPhoto,
  normalizeSupplierAgreementCaption,
  orderedSupplierAgreementPhotos,
  supplierAgreementCaptionChanged,
  supplierAgreementOrderIds,
} from '../src/app/features/products/product-supplier-agreement-state.ts';

function photo(
  id: number,
  position: number,
  caption: string | null = null,
): ProductSupplierAgreementPhoto {
  return {
    id,
    productId: 3,
    supplierId: 7,
    position,
    caption,
    originalFilename: `${id}.jpg`,
    contentType: 'image/jpeg',
    sizeBytes: 10,
    widthPx: 100,
    heightPx: 100,
    viewUrl: `/api/products/3/supplier-agreement/photos/${id}`,
    downloadUrl: `/api/products/3/supplier-agreement/photos/${id}/download`,
  };
}

test('agreement photos use backend position with a stable id fallback', () => {
  assert.deepEqual(
    orderedSupplierAgreementPhotos([photo(9, 2), photo(4, 0), photo(2, 0)]).map((item) => item.id),
    [2, 4, 9],
  );
});

test('moving a photo produces the exact bare id order expected by the backend', () => {
  const moved = moveSupplierAgreementPhoto([photo(1, 0), photo(2, 1), photo(3, 2)], 3, -1);
  assert.deepEqual(supplierAgreementOrderIds(moved), [1, 3, 2]);
  assert.deepEqual(
    moved.map((item) => item.position),
    [0, 1, 2],
  );
});

test('moving beyond either PDF edge is a no-op', () => {
  assert.deepEqual(
    supplierAgreementOrderIds(moveSupplierAgreementPhoto([photo(1, 0), photo(2, 1)], 1, -1)),
    [1, 2],
  );
  assert.deepEqual(
    supplierAgreementOrderIds(moveSupplierAgreementPhoto([photo(1, 0), photo(2, 1)], 2, 1)),
    [1, 2],
  );
});

test('captions compare like the backend: trimmed and blank becomes null', () => {
  assert.equal(normalizeSupplierAgreementCaption('  Handle with care  '), 'Handle with care');
  assert.equal(normalizeSupplierAgreementCaption(' \n '), null);
  assert.equal(
    supplierAgreementCaptionChanged(photo(1, 0, 'Handle with care'), ' Handle with care '),
    false,
  );
  assert.equal(supplierAgreementCaptionChanged(photo(1, 0), 'Front logo centred'), true);
});
