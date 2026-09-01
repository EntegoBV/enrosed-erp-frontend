import type { ProductFamily, ProductFamilyMember } from '../../core/api/models';

export interface ProductVariantNavigation {
  index: number;
  total: number;
  current: ProductFamilyMember;
  previous: ProductFamilyMember | null;
  next: ProductFamilyMember | null;
}

/**
 * Header arrows switch only between the colour/size options of one product
 * family. Inactive members remain reachable because this is the ERP admin:
 * those variants still need inspection and correction.
 */
export function productVariantNavigation(
  family: Pick<ProductFamily, 'members'> | null,
  currentProductId: number | null,
): ProductVariantNavigation | null {
  if (!family || currentProductId === null) return null;

  const members = [...family.members]
    .sort((left, right) => left.position - right.position || left.productId - right.productId);
  if (members.length <= 1) return null;

  const index = members.findIndex((member) => member.productId === currentProductId);
  if (index < 0) return null;

  return {
    index,
    total: members.length,
    current: members[index],
    previous: index > 0 ? members[index - 1] : null,
    next: index < members.length - 1 ? members[index + 1] : null,
  };
}

/** Colour first, with size where it distinguishes another option. */
export function productVariantOptionLabel(member: ProductFamilyMember): string {
  const option = [member.colour, member.size]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value)
    .join(' · ');
  const label = option || member.name.trim() || member.sku?.trim() || `Variant ${member.productId}`;
  return member.active ? label : `${label} (inactief)`;
}
