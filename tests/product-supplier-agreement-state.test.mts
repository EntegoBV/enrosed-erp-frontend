import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductSupplierAgreementPhoto } from '../src/app/core/api/models.ts';
import {
  moveSupplierAgreementPhoto,
  supplierAgreementSelection,
  sameSupplierAgreementSelection,
  sameSupplierAgreementScope,
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


test('explicit colours retain the source and never imply unselected or future colours', () => {
  const selection = [7, 3, 7];
  assert.deepEqual(supplierAgreementSelection(5, selection), [3, 5, 7]);
  assert.deepEqual(selection, [7, 3, 7]);
  assert.deepEqual(supplierAgreementSelection(5, []), [5]);
  assert.equal(sameSupplierAgreementSelection([7, 5, 3], [3, 5, 7]), true);
  assert.equal(sameSupplierAgreementSelection([5, 7], [5, 7, 9]), false);
});

test('a product save cannot silently adopt concurrent supplier, family or applicability changes', () => {
  const before = { productId: 5, sourceProductId: 5, supplierId: 20, familyId: 10, variants: [{ productId: 5 }, { productId: 7 }] };
  assert.equal(sameSupplierAgreementScope(before, { ...before, variants: [...before.variants].reverse() }), true);
  for (const after of [
    { ...before, supplierId: 21 }, { ...before, familyId: 11 },
    { ...before, sourceProductId: 7 }, { ...before, productId: 9 },
    { ...before, variants: [{ productId: 5 }] },
    { ...before, variants: [...before.variants, { productId: 9 }] },
  ]) assert.equal(sameSupplierAgreementScope(before, after), false);
});
