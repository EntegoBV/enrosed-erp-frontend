import type { Category, LandedCostLine, Product } from '../../core/api/models';

export const PURCHASE_LINES_WITHOUT_CATEGORY = 'WITHOUT_CATEGORY' as const;
export const PURCHASE_LINES_WITHOUT_COLOUR = 'WITHOUT_COLOUR' as const;

export type PurchaseLineCategoryFilter =
  | number
  | typeof PURCHASE_LINES_WITHOUT_CATEGORY
  | null;
export type PurchaseLineColourFilter = string | null;

export interface PurchaseLineCategoryOption {
  key: Exclude<PurchaseLineCategoryFilter, null>;
  label: string;
  count: number;
}

export interface PurchaseLineColourOption {
  key: string;
  label: string;
  hex: string | null;
  count: number;
}

export interface PurchaseLineSection {
  key: string;
  categoryKey: Exclude<PurchaseLineCategoryFilter, null>;
  label: string;
  lines: LandedCostLine[];
}

const purchaseLineCollator = new Intl.Collator('nl-BE', {
  numeric: true,
  sensitivity: 'base',
});

/**
 * The editable purchase rows follow the same reading order as the product
 * catalogue: configured category order, product family, canonical variant
 * position and stable colour/size fallbacks.
 */
export function orderPurchaseProductLines(
  lines: readonly LandedCostLine[],
  products: readonly Product[],
  categories: readonly Category[],
): LandedCostLine[] {
  const productById = new Map(products.flatMap((product) =>
    product.id === null ? [] : [[product.id, product] as const]));
  const categoryRank = categoryRanks(categories);

  return lines
    .map((line, index) => ({ line, index }))
    .sort((left, right) => {
      const leftProduct = productById.get(left.line.productId);
      const rightProduct = productById.get(right.line.productId);
      return compareProducts(leftProduct, rightProduct, categoryRank)
        || purchaseLineCollator.compare(left.line.productName, right.line.productName)
        || left.line.productId - right.line.productId
        || left.index - right.index;
    })
    .map(({ line }) => line);
}

/** Category chips only contain groups that are actually present on the order. */
export function purchaseLineCategoryOptions(
  lines: readonly LandedCostLine[],
  products: readonly Product[],
  categories: readonly Category[],
): PurchaseLineCategoryOption[] {
  return purchaseLineSections(lines, products, categories, null, null).map((section) => ({
    key: section.categoryKey,
    label: section.label,
    count: section.lines.length,
  }));
}

/**
 * Colour chips follow the canonical row order rather than a second arbitrary
 * alphabet. Picking a category therefore shows its variant key from left to right.
 */
export function purchaseLineColourOptions(
  lines: readonly LandedCostLine[],
  products: readonly Product[],
  categories: readonly Category[],
  categoryFilter: PurchaseLineCategoryFilter,
): PurchaseLineColourOption[] {
  const productById = productMap(products);
  const options = new Map<string, PurchaseLineColourOption>();
  for (const line of orderPurchaseProductLines(lines, products, categories)) {
    const product = productById.get(line.productId);
    if (!matchesCategory(product, categoryFilter)) continue;
    const key = colourKey(product);
    const existing = options.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    options.set(key, {
      key,
      label: product?.colour?.trim() || 'Zonder kleur',
      hex: product?.colourHex?.trim() || null,
      count: 1,
    });
  }
  return [...options.values()];
}

/** Group the visible editable lines without mutating the server response. */
export function purchaseLineSections(
  lines: readonly LandedCostLine[],
  products: readonly Product[],
  categories: readonly Category[],
  categoryFilter: PurchaseLineCategoryFilter,
  colourFilter: PurchaseLineColourFilter,
): PurchaseLineSection[] {
  const productById = productMap(products);
  const categoryById = new Map(categories.flatMap((category) =>
    category.id === null ? [] : [[category.id, category] as const]));
  const sections = new Map<Exclude<PurchaseLineCategoryFilter, null>, PurchaseLineSection>();

  for (const line of orderPurchaseProductLines(lines, products, categories)) {
    const product = productById.get(line.productId);
    if (!matchesCategory(product, categoryFilter) || !matchesColour(product, colourFilter)) continue;
    const categoryKey = product?.categoryId ?? PURCHASE_LINES_WITHOUT_CATEGORY;
    let section = sections.get(categoryKey);
    if (!section) {
      section = {
        key: typeof categoryKey === 'number' ? `category-${categoryKey}` : 'without-category',
        categoryKey,
        label: typeof categoryKey === 'number'
          ? categoryById.get(categoryKey)?.name ?? `Categorie ${categoryKey}`
          : 'Zonder categorie',
        lines: [],
      };
      sections.set(categoryKey, section);
    }
    section.lines.push(line);
  }
  return [...sections.values()];
}

export function purchaseProductColourKey(product: Product | null | undefined): string {
  return colourKey(product);
}

function productMap(products: readonly Product[]): Map<number, Product> {
  return new Map(products.flatMap((product) =>
    product.id === null ? [] : [[product.id, product] as const]));
}

function categoryRanks(categories: readonly Category[]): ReadonlyMap<number, number> {
  return new Map(
    categories
      .map((category, index) => ({ category, index }))
      .sort((left, right) =>
        left.category.position - right.category.position || left.index - right.index)
      .flatMap(({ category }, index) =>
        category.id === null ? [] : [[category.id, index] as const]),
  );
}

function compareProducts(
  left: Product | undefined,
  right: Product | undefined,
  categoryRank: ReadonlyMap<number, number>,
): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return rankCategory(left, categoryRank) - rankCategory(right, categoryRank)
    || compareText(familyKey(left), familyKey(right))
    || compareNullableNumber(left.familyId, right.familyId)
    || compareNullableNumber(left.variantPosition, right.variantPosition)
    || compareText(variantKey(left), variantKey(right), true)
    || compareText(left.variantSize, right.variantSize, true)
    || compareText(left.sku, right.sku, true)
    || compareNullableNumber(left.id, right.id);
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

function categoryKey(product: Product | null | undefined): Exclude<PurchaseLineCategoryFilter, null> {
  return product?.categoryId ?? PURCHASE_LINES_WITHOUT_CATEGORY;
}

function matchesCategory(
  product: Product | null | undefined,
  filter: PurchaseLineCategoryFilter,
): boolean {
  return filter === null || categoryKey(product) === filter;
}

function colourKey(product: Product | null | undefined): string {
  return product?.colour?.trim().toLocaleLowerCase('nl-BE') || PURCHASE_LINES_WITHOUT_COLOUR;
}

function matchesColour(
  product: Product | null | undefined,
  filter: PurchaseLineColourFilter,
): boolean {
  return filter === null || colourKey(product) === filter;
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
  return purchaseLineCollator.compare(leftValue, rightValue);
}
