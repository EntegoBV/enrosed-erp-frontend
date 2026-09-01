import type { Category, Product, ProductFamily, ProductFamilyMember } from '../../core/api/models';

const catalogueCollator = new Intl.Collator('nl-BE', { numeric: true, sensitivity: 'base' });

export interface ProductVariantNavigation {
  index: number;
  total: number;
  current: ProductFamilyMember;
  previous: ProductFamilyMember | null;
  next: ProductFamilyMember | null;
}

export interface ProductCatalogNavigationTarget {
  productId: number;
  groupKey: string;
  groupName: string;
  optionLabel: string;
}

export interface ProductCatalogNavigation {
  index: number;
  total: number;
  current: ProductCatalogNavigationTarget;
  previous: ProductCatalogNavigationTarget | null;
  next: ProductCatalogNavigationTarget | null;
  previousChangesProduct: boolean;
  nextChangesProduct: boolean;
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

/**
 * Continue from the last colour of one model to the first colour of the next
 * model, following the same category, family and variant order as the product
 * picker. Standalone products remain their own one-item model.
 */
export function productCatalogNavigation(
  products: readonly Product[],
  families: readonly ProductFamily[],
  categories: readonly Category[],
  currentProductId: number | null,
): ProductCatalogNavigation | null {
  if (currentProductId === null) return null;

  const categoryRank = new Map([...categories]
    .sort((left, right) => left.position - right.position)
    .flatMap((category, index) => category.id === null ? [] : [[category.id, index] as const]));
  const familyById = new Map(families.flatMap((family) =>
    family.id === null ? [] : [[family.id, family] as const]));
  const groups = new Map<string, {
    key: string;
    name: string;
    categoryId: number | null;
    position: number | null;
    family: ProductFamily | null;
    products: (Product & { id: number })[];
  }>();
  for (const candidate of products) {
    if (candidate.id === null) continue;
    const product = candidate as Product & { id: number };
    const family = product.familyId === null ? null : familyById.get(product.familyId) ?? null;
    const key = product.familyId === null ? `product-${product.id}` : `family-${product.familyId}`;
    let group = groups.get(key);
    if (!group) {
      const rawCategoryId = family?.categoryId ?? product.categoryId;
      group = {
        key,
        name: family?.name?.trim() || product.familyKey?.trim() || product.name,
        categoryId: rawCategoryId !== null && categoryRank.has(rawCategoryId) ? rawCategoryId : null,
        position: family?.productPosition ?? null,
        family,
        products: [],
      };
      groups.set(key, group);
    }
    group.products.push(product);
  }

  const orderedGroups = [...groups.values()].sort((left, right) =>
    catalogCategoryOrder(left.categoryId, categoryRank) - catalogCategoryOrder(right.categoryId, categoryRank)
    || catalogNullableNumber(left.position, right.position)
    || catalogueCollator.compare(left.name, right.name)
    || catalogueCollator.compare(left.key, right.key));
  const entries = orderedGroups.flatMap((group) => {
    const memberRank = new Map((group.family?.members ?? []).map((member) =>
      [member.productId, member.position] as const));
    const variants = [...group.products].sort((left, right) =>
      catalogNullableNumber(memberRank.get(left.id) ?? null, memberRank.get(right.id) ?? null)
      || catalogNullableNumber(left.variantPosition, right.variantPosition)
      || catalogueCollator.compare(left.canonicalVariantKey ?? '', right.canonicalVariantKey ?? '')
      || catalogueCollator.compare(left.variantSize ?? '', right.variantSize ?? '')
      || catalogueCollator.compare(left.sku ?? '', right.sku ?? '')
      || left.id - right.id);
    return variants.map((product, index) => ({
      index,
      total: variants.length,
      target: {
        productId: product.id,
        groupKey: group.key,
        groupName: group.name,
        optionLabel: catalogProductOptionLabel(product),
      },
    }));
  });
  if (entries.length <= 1) return null;

  const currentIndex = entries.findIndex((entry) => entry.target.productId === currentProductId);
  if (currentIndex < 0) return null;
  const current = entries[currentIndex];
  const previous = entries[currentIndex - 1]?.target ?? null;
  const next = entries[currentIndex + 1]?.target ?? null;
  return {
    index: current.index,
    total: current.total,
    current: current.target,
    previous,
    next,
    previousChangesProduct: previous !== null && previous.groupKey !== current.target.groupKey,
    nextChangesProduct: next !== null && next.groupKey !== current.target.groupKey,
  };
}

function catalogProductOptionLabel(product: Product): string {
  const option = [product.colour, product.variantSize]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(' · ');
  const label = option || product.name.trim() || product.sku?.trim() || `Product ${product.id}`;
  return product.active ? label : `${label} (inactief)`;
}

function catalogCategoryOrder(
  categoryId: number | null,
  ranks: ReadonlyMap<number, number>,
): number {
  return categoryId === null ? Number.MAX_SAFE_INTEGER : ranks.get(categoryId) ?? Number.MAX_SAFE_INTEGER - 1;
}

function catalogNullableNumber(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}
