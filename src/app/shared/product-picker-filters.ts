import type { Category, Product } from '../core/api/models';

export const UNCATEGORISED_PICKER_CATEGORY = '__uncategorised__' as const;
export const NO_PICKER_COLOUR = '__no-colour__' as const;

export type ProductPickerCategoryKey = number | typeof UNCATEGORISED_PICKER_CATEGORY;

export interface ProductPickerCategoryOption {
  key: ProductPickerCategoryKey;
  name: string;
  count: number;
}

export interface ProductPickerColourOption {
  /** Normalised value, so colour spelling/casing cannot create duplicate filters. */
  key: string;
  name: string;
  count: number;
  hex: string | null;
}

export interface ProductPickerFilter {
  query: string;
  category: ProductPickerCategoryKey | null;
  colour: string | null;
  limit?: number;
  /** Optional caller-owned search metadata, for example a supplier name. */
  searchTextOf?: (product: Product) => string | null | undefined;
}

const collator = new Intl.Collator('nl-BE', { numeric: true, sensitivity: 'base' });
/** Categories that actually occur in this picker, in the configured catalogue order. */
export function productPickerCategories(
  products: readonly Product[],
  categories: readonly Category[],
): ProductPickerCategoryOption[] {
  const counts = new Map<number | null, number>();
  for (const product of products) {
    counts.set(product.categoryId, (counts.get(product.categoryId) ?? 0) + 1);
  }

  const configured = categories
    .map((category, index) => ({ category, index }))
    .filter(({ category }) => category.id !== null && (counts.get(category.id) ?? 0) > 0)
    .sort((left, right) =>
      left.category.position - right.category.position || left.index - right.index)
    .map(({ category }) => ({
      key: category.id!,
      name: category.name,
      count: counts.get(category.id) ?? 0,
    }));

  const knownIds = new Set(categories.flatMap((category) =>
    category.id === null ? [] : [category.id]));
  const unknownCount = [...counts.entries()]
    .filter(([categoryId]) => categoryId === null || !knownIds.has(categoryId))
    .reduce((sum, [, count]) => sum + count, 0);

  return unknownCount > 0
    ? [...configured, { key: UNCATEGORISED_PICKER_CATEGORY, name: 'Zonder categorie', count: unknownCount }]
    : configured;
}

/**
 * Visible colour choices for the current category. Standard ENROSED colours
 * follow their shared colour key; supplier-specific additions come after it.
 */
export function productPickerColours(
  products: readonly Product[],
  categories: readonly Category[],
  category: ProductPickerCategoryKey | null,
  standardColours: readonly string[],
  colourSwatches: Readonly<Record<string, string>>,
): ProductPickerColourOption[] {
  const knownCategoryIds = categoryIds(categories);
  const standardColourRank = new Map(
    standardColours.map((colour, index) => [normalisePickerColour(colour), index]),
  );
  const options = new Map<string, ProductPickerColourOption>();
  for (const product of products) {
    if (!matchesCategory(product, category, knownCategoryIds)) continue;
    const key = productColourKey(product);
    const current = options.get(key);
    if (current) {
      current.count += 1;
      if (!current.hex && product.colourHex) current.hex = product.colourHex;
      continue;
    }
    const name = product.colour?.trim() || 'Zonder kleur';
    options.set(key, {
      key,
      name,
      count: 1,
      hex: product.colourHex || defaultColourHex(name, standardColours, colourSwatches),
    });
  }

  return [...options.values()].sort((left, right) => {
    if (left.key === NO_PICKER_COLOUR) return right.key === NO_PICKER_COLOUR ? 0 : 1;
    if (right.key === NO_PICKER_COLOUR) return -1;
    const leftRank = standardColourRank.get(left.key) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = standardColourRank.get(right.key) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || collator.compare(left.name, right.name);
  });
}

/** One combined filter: category, colour and text narrow the same ordered source. */
export function filterProductPicker(
  orderedProducts: readonly Product[],
  categories: readonly Category[],
  filter: ProductPickerFilter,
): Product[] {
  const needle = normaliseSearch(filter.query);
  const knownCategoryIds = categoryIds(categories);
  const limit = filter.limit ?? 50;

  return orderedProducts
    .filter((product) => matchesCategory(product, filter.category, knownCategoryIds))
    .filter((product) => filter.colour === null || productColourKey(product) === filter.colour)
    .filter((product) => {
      if (!needle) return true;
      return normaliseSearch([
        product.name,
        product.sku,
        product.colour,
        product.variantSize,
        product.describedAs,
        product.barcodeInner,
        product.barcodeOuter,
        productPickerCategoryName(product, categories),
        filter.searchTextOf?.(product),
      ].join(' ')).includes(needle);
    })
    .slice(0, limit);
}

export function productPickerCategoryName(
  product: Product,
  categories: readonly Category[],
): string {
  if (product.categoryId === null) return 'Zonder categorie';
  return categories.find((category) => category.id === product.categoryId)?.name ?? 'Zonder categorie';
}

export function productColourKey(product: Pick<Product, 'colour'>): string {
  return normalisePickerColour(product.colour) || NO_PICKER_COLOUR;
}

export function normalisePickerColour(colour: string | null | undefined): string {
  return colour?.trim().toLocaleLowerCase('nl-BE') ?? '';
}

function matchesCategory(
  product: Product,
  category: ProductPickerCategoryKey | null,
  knownCategoryIds: ReadonlySet<number>,
): boolean {
  if (category === null) return true;
  if (category === UNCATEGORISED_PICKER_CATEGORY) {
    return product.categoryId === null || !knownCategoryIds.has(product.categoryId);
  }
  return product.categoryId === category;
}

function categoryIds(categories: readonly Category[]): Set<number> {
  return new Set(categories.flatMap((category) => category.id === null ? [] : [category.id]));
}

function normaliseSearch(value: string): string {
  return value.trim().toLocaleLowerCase('nl-BE');
}

function defaultColourHex(
  colour: string,
  standardColours: readonly string[],
  colourSwatches: Readonly<Record<string, string>>,
): string | null {
  const canonical = standardColours.find((item) =>
    normalisePickerColour(item) === normalisePickerColour(colour));
  return canonical ? colourSwatches[canonical] ?? null : null;
}
