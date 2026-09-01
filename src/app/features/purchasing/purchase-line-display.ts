import type { Category, LandedCostLine, Product } from '../../core/api/models';

const collator = new Intl.Collator('nl-BE', {
  numeric: true,
  sensitivity: 'base',
});

/** Stable value used for products whose colour has not been filled in. */
export const PURCHASE_NO_COLOUR = '__NO_COLOUR__';

export interface PurchaseColourOption {
  key: string;
  label: string;
  hex: string | null;
  count: number;
}

export interface PurchaseLineEntry {
  line: LandedCostLine;
  product: Product | null;
  displayIndex: number;
}

export interface PurchaseLineSection {
  key: string;
  name: string;
  entries: PurchaseLineEntry[];
}

/**
 * The colours that occur in this order, in the same business order as the
 * product colour key. Custom colours follow alphabetically and an empty
 * colour stays last.
 */
export function purchaseColourOptions(
  lines: readonly LandedCostLine[],
  products: readonly Product[],
  standardColours: readonly string[],
  colourSwatches: Readonly<Record<string, string>>,
): PurchaseColourOption[] {
  const productsById = new Map(products.flatMap((product) =>
    product.id === null ? [] : [[product.id, product] as const]));
  const options = new Map<string, PurchaseColourOption>();

  for (const line of lines) {
    const product = productsById.get(line.productId) ?? null;
    const key = colourKey(product);
    const existing = options.get(key);
    if (existing) {
      existing.count += 1;
      if (!existing.hex) existing.hex = purchaseColourHex(product, colourSwatches);
      continue;
    }
    options.set(key, {
      key,
      label: product?.colour?.trim() || 'Zonder kleur',
      hex: purchaseColourHex(product, colourSwatches),
      count: 1,
    });
  }

  return [...options.values()].sort((left, right) =>
    compareColourOptions(left, right, standardColours));
}

/**
 * Cut an order into its configured category sections and keep families
 * together in their canonical variant position. The product colour key is
 * the deterministic fallback for legacy variants without a position.
 */
export function purchaseLineSections(
  lines: readonly LandedCostLine[],
  products: readonly Product[],
  categories: readonly Category[],
  selectedColour: string | null,
  standardColours: readonly string[],
): PurchaseLineSection[] {
  const productsById = new Map(products.flatMap((product) =>
    product.id === null ? [] : [[product.id, product] as const]));
  const categoriesById = new Map(categories.flatMap((category) =>
    category.id === null ? [] : [[category.id, category] as const]));
  const categoryRank = new Map(
    [...categories]
      .map((category, index) => ({ category, index }))
      .sort((left, right) => left.category.position - right.category.position || left.index - right.index)
      .flatMap(({ category }, index) => category.id === null ? [] : [[category.id, index] as const]),
  );

  const sorted = lines
    .map((line, sourceIndex) => ({
      line,
      sourceIndex,
      product: productsById.get(line.productId) ?? null,
    }))
    .filter(({ product }) => selectedColour === null || colourKey(product) === selectedColour)
    .sort((left, right) =>
      categoryOrder(left.product, categoryRank) - categoryOrder(right.product, categoryRank)
      || compareText(familyKey(left.product, left.line), familyKey(right.product, right.line))
      || nullableNumber(left.product?.variantPosition, right.product?.variantPosition)
      || colourOrder(left.product, standardColours) - colourOrder(right.product, standardColours)
      || compareText(colourLabel(left.product), colourLabel(right.product), true)
      || compareText(left.product?.variantSize, right.product?.variantSize, true)
      || compareText(left.product?.sku, right.product?.sku, true)
      || left.sourceIndex - right.sourceIndex);

  const sections = new Map<number | null, PurchaseLineSection>();
  sorted.forEach((item, index) => {
    const categoryId = item.product?.categoryId ?? null;
    let section = sections.get(categoryId);
    if (!section) {
      section = {
        key: categoryId === null ? 'none' : `category-${categoryId}`,
        name: categoryId === null
          ? 'Zonder categorie'
          : categoriesById.get(categoryId)?.name ?? 'Onbekende categorie',
        entries: [],
      };
      sections.set(categoryId, section);
    }
    section.entries.push({ line: item.line, product: item.product, displayIndex: index + 1 });
  });

  return [...sections.values()];
}

function colourKey(product: Product | null): string {
  const label = product?.colour?.trim();
  return label ? label.toLocaleLowerCase('nl-BE') : PURCHASE_NO_COLOUR;
}

function colourLabel(product: Product | null): string | null {
  return product?.colour?.trim() || null;
}

export function purchaseColourHex(
  product: Product | null,
  colourSwatches: Readonly<Record<string, string>>,
): string | null {
  const label = colourLabel(product);
  return product?.colourHex || (label ? colourSwatches[label] : null) || null;
}

function colourOrder(product: Product | null, standardColours: readonly string[]): number {
  const label = colourLabel(product);
  if (!label) return Number.MAX_SAFE_INTEGER;
  const index = standardColours.findIndex((colour) => collator.compare(colour, label) === 0);
  return index < 0 ? standardColours.length : index;
}

function compareColourOptions(
  left: PurchaseColourOption,
  right: PurchaseColourOption,
  standardColours: readonly string[],
): number {
  const leftRank = left.key === PURCHASE_NO_COLOUR
    ? Number.MAX_SAFE_INTEGER
    : standardColours.findIndex((colour) => collator.compare(colour, left.label) === 0);
  const rightRank = right.key === PURCHASE_NO_COLOUR
    ? Number.MAX_SAFE_INTEGER
    : standardColours.findIndex((colour) => collator.compare(colour, right.label) === 0);
  const rankedLeft = leftRank < 0 ? standardColours.length : leftRank;
  const rankedRight = rightRank < 0 ? standardColours.length : rightRank;
  return rankedLeft - rankedRight || collator.compare(left.label, right.label);
}

function categoryOrder(product: Product | null, ranks: ReadonlyMap<number, number>): number {
  const id = product?.categoryId;
  if (id === null || id === undefined) return Number.MAX_SAFE_INTEGER;
  return ranks.get(id) ?? Number.MAX_SAFE_INTEGER - 1;
}

function familyKey(product: Product | null, line: LandedCostLine): string {
  return product?.familyKey?.trim()
    || (product?.familyId === null || product?.familyId === undefined ? '' : `family-${product.familyId}`)
    || product?.name
    || line.productName;
}

function nullableNumber(left: number | null | undefined, right: number | null | undefined): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
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
  return collator.compare(leftValue, rightValue);
}
