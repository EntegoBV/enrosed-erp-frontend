import type { Category, Product } from '../../core/api/models';

const catalogueCollator = new Intl.Collator('nl-BE', {
  numeric: true,
  sensitivity: 'base',
});

/**
 * One deterministic order for the catalogue picker and the export request.
 * Categories follow their configured rank; variants stay together by family
 * and then use the server-owned variant position before stable text fallbacks.
 */
export function orderCatalogProducts(
  products: readonly Product[],
  categories: readonly Category[],
): Product[] {
  const categoryRank = new Map(
    [...categories]
      .map((category, index) => ({ category, index }))
      .sort(
        (left, right) =>
          left.category.position - right.category.position || left.index - right.index,
      )
      .flatMap(({ category }, index) =>
        category.id === null ? [] : [[category.id, index] as const],
      ),
  );

  return products
    .map((product, index) => ({ product, index }))
    .sort(
      (left, right) =>
        compareProducts(left.product, right.product, categoryRank) || left.index - right.index,
    )
    .map(({ product }) => product);
}

function compareProducts(
  left: Product,
  right: Product,
  categoryRank: ReadonlyMap<number, number>,
): number {
  return (
    rankCategory(left, categoryRank) - rankCategory(right, categoryRank) ||
    compareText(familyKey(left), familyKey(right)) ||
    compareNullableNumber(left.familyId, right.familyId) ||
    compareNullableNumber(left.variantPosition, right.variantPosition) ||
    compareText(variantKey(left), variantKey(right), true) ||
    compareText(left.variantSize, right.variantSize, true) ||
    compareText(left.sku, right.sku, true) ||
    compareNullableNumber(left.id, right.id)
  );
}

function rankCategory(product: Product, ranks: ReadonlyMap<number, number>): number {
  if (product.categoryId === null) return Number.MAX_SAFE_INTEGER;
  return ranks.get(product.categoryId) ?? Number.MAX_SAFE_INTEGER - 1;
}

function familyKey(product: Product): string {
  const canonical = product.familyKey?.trim();
  if (canonical) return canonical;
  if (product.familyId !== null) return `family-${product.familyId}`;
  return `product-${product.name.trim()}-${product.id ?? ''}`;
}

function variantKey(product: Product): string | null {
  const canonical = product.canonicalVariantKey?.trim();
  if (canonical) {
    const family = product.familyKey?.trim();
    if (family && canonical.startsWith(`${family}-`)) return canonical.slice(family.length + 1);
    return canonical;
  }
  return product.colour?.trim() || null;
}

function compareNullableNumber(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function compareText(
  left: string | null | undefined,
  right: string | null | undefined,
  emptyLast = false,
): number {
  const leftValue = left?.trim() ?? '';
  const rightValue = right?.trim() ?? '';
  if (emptyLast) {
    const emptyOrder = Number(!leftValue) - Number(!rightValue);
    if (emptyOrder) return emptyOrder;
  }
  return catalogueCollator.compare(leftValue, rightValue);
}
