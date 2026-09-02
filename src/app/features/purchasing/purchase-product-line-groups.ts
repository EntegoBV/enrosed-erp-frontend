import type { Category, LandedCostLine, Product, ProductFamily } from '../../core/api/models';

export const PURCHASE_LINES_WITHOUT_CATEGORY = 'WITHOUT_CATEGORY' as const;

export type PurchaseLineCategoryFilter =
  | number
  | typeof PURCHASE_LINES_WITHOUT_CATEGORY
  | null;

export interface PurchaseLineCategoryOption {
  key: Exclude<PurchaseLineCategoryFilter, null>;
  label: string;
  count: number;
}

export interface PurchaseLineFamilySwatch {
  key: string;
  label: string;
  hex: string | null;
}

export interface PurchaseLineFamilyGroup {
  key: string;
  familyId: number | null;
  label: string;
  lines: LandedCostLine[];
  swatches: PurchaseLineFamilySwatch[];
  pieces: number;
  cartons: number;
  cbm: number;
  totalEur: number;
  averageUnitEur: number;
}

export interface PurchaseLineSection {
  key: string;
  categoryKey: Exclude<PurchaseLineCategoryFilter, null>;
  label: string;
  lines: LandedCostLine[];
  families: PurchaseLineFamilyGroup[];
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
  families: readonly ProductFamily[] = [],
): LandedCostLine[] {
  const productById = new Map(products.flatMap((product) =>
    product.id === null ? [] : [[product.id, product] as const]));
  const categoryRank = categoryRanks(categories);
  const familyRank = new Map(families.flatMap((family) =>
    family.id === null ? [] : [[family.id, family.productPosition] as const]));

  return lines
    .map((line, index) => ({ line, index }))
    .sort((left, right) => {
      const leftProduct = productById.get(left.line.productId);
      const rightProduct = productById.get(right.line.productId);
      return compareProducts(leftProduct, rightProduct, categoryRank, familyRank)
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
  return purchaseLineSections(lines, products, categories, [], null).map((section) => ({
    key: section.categoryKey,
    label: section.label,
    count: section.lines.length,
  }));
}

/**
 * Group the visible editable lines without mutating the server response.
 *
 * Categories remain useful as coarse navigation, but colours are variants of
 * one product model rather than filters. A persisted family therefore forms a
 * single group; a standalone or legacy product receives its own stable group.
 */
export function purchaseLineSections(
  lines: readonly LandedCostLine[],
  products: readonly Product[],
  categories: readonly Category[],
  families: readonly ProductFamily[],
  categoryFilter: PurchaseLineCategoryFilter,
): PurchaseLineSection[] {
  const productById = productMap(products);
  const categoryById = new Map(categories.flatMap((category) =>
    category.id === null ? [] : [[category.id, category] as const]));
  const familyById = new Map(families.flatMap((family) =>
    family.id === null ? [] : [[family.id, family] as const]));
  const sections = new Map<Exclude<PurchaseLineCategoryFilter, null>, PurchaseLineSection>();
  for (const line of orderPurchaseProductLines(lines, products, categories, families)) {
    const product = productById.get(line.productId);
    if (!matchesCategory(product, categoryFilter)) continue;
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
        families: [],
      };
      sections.set(categoryKey, section);
    }
    section.lines.push(line);

    const familyId = product?.familyId ?? null;
    const groupKey = familyId === null ? `product-${line.productId}` : `family-${familyId}`;
    let group = section.families.find((candidate) => candidate.key === groupKey);
    if (!group) {
      group = {
        key: groupKey,
        familyId,
        label: familyLabel(product, line, familyById.get(familyId ?? -1)),
        lines: [],
        swatches: [],
        pieces: 0,
        cartons: 0,
        cbm: 0,
        totalEur: 0,
        averageUnitEur: 0,
      };
      section.families.push(group);
    }
    group.lines.push(line);
    group.pieces += finite(line.quantity);
    group.cartons += finite(line.cartons);
    group.cbm += finite(line.cbm);
    group.totalEur += finite(line.totalEur);
    group.averageUnitEur = group.pieces > 0 ? group.totalEur / group.pieces : 0;
    addSwatch(group.swatches, product);
  }
  return [...sections.values()];
}

function familyLabel(
  product: Product | undefined,
  line: LandedCostLine,
  family: ProductFamily | undefined,
): string {
  const publicName = family?.name?.trim();
  if (publicName) return publicName;
  return fallbackProductFamilyName(product, line.productName);
}

function addSwatch(swatches: PurchaseLineFamilySwatch[], product: Product | undefined): void {
  const label = product?.colour?.trim();
  if (!label) return;
  const key = label.toLocaleLowerCase('nl-BE');
  const existing = swatches.find((swatch) => swatch.key === key);
  if (existing) {
    if (!existing.hex && product?.colourHex?.trim()) existing.hex = product.colourHex.trim();
    return;
  }
  swatches.push({ key, label, hex: product?.colourHex?.trim() || null });
}

function finite(value: number | null | undefined): number {
  return Number.isFinite(value) ? value! : 0;
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
  familyRank: ReadonlyMap<number, number>,
): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return rankCategory(left, categoryRank) - rankCategory(right, categoryRank)
    || rankFamily(left, familyRank) - rankFamily(right, familyRank)
    || compareText(familyKey(left), familyKey(right))
    || compareNullableNumber(left.familyId, right.familyId)
    || compareNullableNumber(left.variantPosition, right.variantPosition)
    || compareText(variantKey(left), variantKey(right), true)
    || compareText(left.variantSize, right.variantSize, true)
    || compareText(left.sku, right.sku, true)
    || compareNullableNumber(left.id, right.id);
}

function rankFamily(product: Product, ranks: ReadonlyMap<number, number>): number {
  if (product.familyId === null) return Number.MAX_SAFE_INTEGER;
  return ranks.get(product.familyId) ?? Number.MAX_SAFE_INTEGER - 1;
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

function fallbackProductFamilyName(product: Product | null | undefined, fallback: string): string {
  const familyKey = product?.familyKey?.trim();
  if (familyKey) return sentenceCase(familyKey.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim());
  let name = product?.name?.trim() || fallback.trim();
  for (const variant of [product?.variantSize, product?.colour]) {
    const value = variant?.trim();
    if (!value) continue;
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    name = name.replace(new RegExp(`(?:\\s*[·,/|-]\\s*|\\s+)${escaped}\\s*$`, 'iu'), '').trim();
  }
  return name || fallback;
}

function sentenceCase(value: string): string {
  return value ? value[0].toLocaleUpperCase('nl-BE') + value.slice(1) : value;
}
