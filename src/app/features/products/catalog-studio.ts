import type { PhotoDto, Product, ProductFamily } from '../../core/api/models';

/** Use the same explicit catalogue lead as the PDF, preserving original media. */
export function cataloguePhoto(product: Pick<Product, 'photos'>): PhotoDto | null {
  return product.photos.find((photo) => photo.leadFor?.includes('CATALOGUE'))
    ?? product.photos[0] ?? null;
}

export function catalogueFamilyKey(product: Pick<Product, 'id' | 'familyId'>): string {
  return product.familyId === null ? `product:${product.id}` : `family:${product.familyId}`;
}

export interface CatalogueFamilySelection {
  key: string;
  name: string;
  products: Product[];
  photo: PhotoDto | null;
}

/** Keep catalogue order; unlinked products each remain an independent group. */
export function catalogueFamilies(
  products: readonly Product[],
  families: readonly Pick<ProductFamily, 'id' | 'name'>[],
): CatalogueFamilySelection[] {
  const names = new Map(families.map((family) => [family.id, family.name]));
  const groups = new Map<string, CatalogueFamilySelection>();
  for (const product of products) {
    if (product.id === null) continue;
    const key = catalogueFamilyKey(product);
    const existing = groups.get(key);
    if (existing) {
      existing.products.push(product);
      const candidate = cataloguePhoto(product);
      if (!existing.photo || (!existing.photo.leadFor?.includes('CATALOGUE')
          && candidate?.leadFor?.includes('CATALOGUE'))) existing.photo = candidate;
    } else {
      groups.set(key, {
        key,
        name: names.get(product.familyId) || product.name,
        products: [product],
        photo: cataloguePhoto(product),
      });
    }
  }
  return [...groups.values()];
}
