import { ProductFamily } from '../core/api/models';

export interface FeaturedProductEligibility {
  active: boolean;
  hasPublicImage: boolean;
  eligible: boolean;
}

export function featuredProductEligibility(
  family: ProductFamily | null,
  productId: number,
  active: boolean,
): FeaturedProductEligibility {
  // The backend applies the same ERP-photo rules as the public catalogue. Drafts
  // and older API responses stay unavailable until that authority is present.
  const hasPublicImage = family?.members.find((member) => member.productId === productId)
    ?.hasPublicWebsiteImage === true;
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
