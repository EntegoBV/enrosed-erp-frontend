import { ProductFamily, ProductFamilyImage } from '../core/api/models';

export interface FeaturedProductEligibility {
  active: boolean;
  hasPublicImage: boolean;
  eligible: boolean;
}

/** A legacy variant hint means the image is not safely family-wide. */
export function isFamilyWideImage(image: ProductFamilyImage): boolean {
  return image.variantProductId === null
    && !image.variantExternalId?.trim()
    && !image.variantColor?.trim();
}

export function isPublicReadyImage(image: ProductFamilyImage): boolean {
  const renditionDimensions = [
    image.smallWidthPx,
    image.smallHeightPx,
    image.largeWidthPx,
    image.largeHeightPx,
  ];
  return Boolean(
    image.sourceKey?.trim()
      && image.smallUrl?.trim()
      && image.largeUrl?.trim(),
  )
    && renditionDimensions.every((dimension) =>
      typeof dimension === 'number' && Number.isFinite(dimension) && dimension > 0)
    && image.altTexts.some((text) => Boolean(text.alt?.trim()));
}

export function featuredProductEligibility(
  family: ProductFamily | null,
  productId: number,
  active: boolean,
): FeaturedProductEligibility {
  const hasPublicImage = family?.images.some((image) =>
    isPublicReadyImage(image)
      && (isFamilyWideImage(image) || image.variantProductId === productId)) ?? false;
  return { active, hasPublicImage, eligible: active && hasPublicImage };
}

export function familyForProduct(
  families: ProductFamily[],
  familyId: number | null,
): ProductFamily | null {
  if (familyId === null) return null;
  return families.find((family) => family.id === familyId) ?? null;
}

export function productBelongsToCategory(
  family: ProductFamily | null,
  productCategoryId: number | null,
  categoryId: number,
  categoryCode: string,
): boolean {
  // Category merchandising follows the family's primary category only.
  // productCategoryId remains a fallback only when no family exists.
  if (!family) return productCategoryId === categoryId;
  return family.categoryId === categoryId || family.categoryKey === categoryCode;
}
