import type { PhotoDto, Product } from '../core/api/models';

/**
 * The image shown while building a quote or reviewing its lines.
 *
 * Product photo position 0 is the old ERP fallback and can be a catalogue
 * cut-out or an earlier upload. Prefer the explicit website lead; when a
 * family variant has no own lead, the inherited row is the canonical photo
 * linked by its numeric familyPhotoId. Keep the first photo only as the
 * fallback for products that predate the family gallery.
 */
export function salesPhoto(product: Pick<Product, 'photos'>): PhotoDto | null {
  return product.photos.find((photo) => photo.leadFor?.includes('WEBSITE'))
    ?? product.photos.find((photo) => photo.familyPhotoId !== null)
    ?? product.photos[0]
    ?? null;
}

export function salesPhotoUrl(product: Pick<Product, 'photos'>): string | null {
  return salesPhoto(product)?.url ?? null;
}
