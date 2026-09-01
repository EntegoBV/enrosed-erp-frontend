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
