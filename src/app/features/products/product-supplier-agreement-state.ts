import type { ProductSupplierAgreementPhoto } from '../../core/api/models';

export const SUPPLIER_AGREEMENT_CAPTION_MAX = 500;

/** The backend owns positions; the id tie-break keeps legacy/equal rows stable. */
export function orderedSupplierAgreementPhotos(
  photos: readonly ProductSupplierAgreementPhoto[],
): ProductSupplierAgreementPhoto[] {
  return [...photos].sort((left, right) => left.position - right.position || left.id - right.id);
}

export function normalizeSupplierAgreementCaption(value: string | null | undefined): string | null {
  const caption = value?.trim() ?? '';
  return caption || null;
}

export function supplierAgreementCaptionChanged(
  photo: ProductSupplierAgreementPhoto,
  draft: string | null | undefined,
): boolean {
  return (
    normalizeSupplierAgreementCaption(draft) !== normalizeSupplierAgreementCaption(photo.caption)
  );
}

/** Moves one photo exactly one PDF position and returns a normalized local projection. */
export function moveSupplierAgreementPhoto(
  photos: readonly ProductSupplierAgreementPhoto[],
  photoId: number,
  direction: -1 | 1,
): ProductSupplierAgreementPhoto[] {
  const ordered = orderedSupplierAgreementPhotos(photos);
  const from = ordered.findIndex((photo) => photo.id === photoId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ordered.length) return ordered;
  [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
  return ordered.map((photo, position) => ({ ...photo, position }));
}

export function supplierAgreementOrderIds(
  photos: readonly ProductSupplierAgreementPhoto[],
): number[] {
  return orderedSupplierAgreementPhotos(photos).map((photo) => photo.id);
}

/** Explicit applicability always includes its source; future variants are never implied. */
export function supplierAgreementSelection(sourceId: number, ids: readonly number[]): number[] {
  return [...new Set([sourceId, ...ids])].sort((a, b) => a - b);
}

export function sameSupplierAgreementSelection(left: readonly number[], right: readonly number[]): boolean {
  return [...new Set(left)].sort((a, b) => a - b).join(',') === [...new Set(right)].sort((a, b) => a - b).join(',');
}

/** A parent save may update its own text/photos; it must not overwrite a concurrent group change. */
export function sameSupplierAgreementScope(
  before: { productId: number; sourceProductId: number; supplierId: number | null; familyId: number | null; variants: { productId: number }[] },
  after: { productId: number; sourceProductId: number; supplierId: number | null; familyId: number | null; variants: { productId: number }[] },
): boolean {
  return before.productId === after.productId && before.sourceProductId === after.sourceProductId &&
    before.supplierId === after.supplierId && before.familyId === after.familyId &&
    sameSupplierAgreementSelection(before.variants.map(v => v.productId), after.variants.map(v => v.productId));
}
