import type { Category, Product, ProductFamily } from '../core/api/models';
import type { ProductPickerCategoryKey } from './product-picker-filters';

const UNCATEGORISED_PICKER_CATEGORY = '__uncategorised__' as const;

export interface ProductPickerFamilyGroup {
  key: string;
  family: ProductFamily | null;
  name: string;
  products: Product[];
  lead: Product;
  photo: string | null;
  colours: { name: string; hex: string | null }[];
  sizes: string[];
}

export interface ProductPickerFamilySection {
  key: string;
  categoryId: number | null;
  name: string;
  groups: ProductPickerFamilyGroup[];
  productCount: number;
}

export interface ProductPickerFamilyFilter {
  query: string;
  category: ProductPickerCategoryKey | null;
  /** Limit complete product ranges, never individual colours from a range. */
  limit?: number;
}

export interface ProductPickerSelectionEntry {
  product: Product;
  quantity: number;
}

export type ProductPickerFamilySelectionState = 'none' | 'partial' | 'all';

/**
 * Product ranges start folded, including ranges with a single variant.
 * A search may reveal matching variants immediately, while an explicit user
 * choice always wins until the picker closes.
 */
export function productPickerGroupOpen(query: string, override: boolean | undefined): boolean {
  return override ?? query.trim().length > 0;
}

const collator = new Intl.Collator('nl-BE', { numeric: true, sensitivity: 'base' });

/**
 * Turn a flat SKU list into the same hierarchy people see in the product
 * overview: category, product range, then colour/size variants. A search hit
 * keeps the complete range together, so the 50-result guard can never cut a
 * range in half.
 */
export function productPickerFamilySections(
  orderedProducts: readonly Product[],
  families: readonly ProductFamily[],
  categories: readonly Category[],
  filter: ProductPickerFamilyFilter,
): ProductPickerFamilySection[] {
  const knownCategoryIds = new Set(categories.flatMap((category) =>
    category.id === null ? [] : [category.id]));
  const familyById = new Map(families.flatMap((family) =>
    family.id === null ? [] : [[family.id, family] as const]));
  const sourceRank = new Map(orderedProducts.map((product, index) => [product, index]));
  const groups = new Map<string, ProductPickerFamilyGroup>();

  for (const product of orderedProducts) {
    if (!matchesCategory(product, filter.category, knownCategoryIds)) continue;
    const family = product.familyId === null ? null : familyById.get(product.familyId) ?? null;
    const key = product.familyId === null ? `product-${product.id}` : `family-${product.familyId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        family,
        name: family?.name?.trim() || fallbackProductFamilyName(product, product.name),
        products: [],
        lead: product,
        photo: null,
        colours: [],
        sizes: [],
      };
      groups.set(key, group);
    }
    group.products.push(product);
    if (!group.photo && product.photos?.length) group.photo = product.photos[0].url;
  }

  const needle = normalize(filter.query);
  const visibleGroups = [...groups.values()]
    .filter((group) => !needle || groupSearchText(group, categories).includes(needle))
    .sort((left, right) => compareGroups(left, right, sourceRank))
    .slice(0, filter.limit ?? 50);

  for (const group of visibleGroups) {
    const memberRank = new Map((group.family?.members ?? []).map((member) =>
      [member.productId, member.position] as const));
    group.products.sort((left, right) =>
      nullableNumber(memberRank.get(left.id!), memberRank.get(right.id!))
      || nullableNumber(left.variantPosition, right.variantPosition)
      || compareText(variantKey(left), variantKey(right), true)
      || compareText(left.variantSize, right.variantSize, true)
      || compareText(left.sku, right.sku, true)
      || (sourceRank.get(left) ?? 0) - (sourceRank.get(right) ?? 0));
    /* The compact header must read in the same order as the rows it previews. */
    group.colours = [];
    group.sizes = [];
    for (const product of group.products) {
      const colour = product.colour?.trim();
      if (colour) {
        const existing = group.colours.find((item) => collator.compare(item.name, colour) === 0);
        if (existing) {
          if (!existing.hex && product.colourHex?.trim()) existing.hex = product.colourHex.trim();
        } else {
          group.colours.push({ name: colour, hex: product.colourHex?.trim() || null });
        }
      }
      const size = product.variantSize?.trim();
      if (size && !group.sizes.some((item) => collator.compare(item, size) === 0)) {
        group.sizes.push(size);
      }
    }
    const canonicalLead = group.products.find((product) =>
      product.id === group.family?.cardFeaturedProductId)
      ?? group.products.find((product) => isRed(product.colour))
      ?? group.products[0];
    group.lead = canonicalLead;
    if (canonicalLead.photos?.length) group.photo = canonicalLead.photos[0].url;
  }

  const categoryById = new Map(categories.flatMap((category) =>
    category.id === null ? [] : [[category.id, category] as const]));
  const categoryRank = new Map(
    [...categories]
      .map((category, index) => ({ category, index }))
      .sort((left, right) =>
        left.category.position - right.category.position || left.index - right.index)
      .flatMap(({ category }, index) =>
        category.id === null ? [] : [[category.id, index] as const]),
  );
  const sections = new Map<number | null, ProductPickerFamilySection>();
  for (const group of visibleGroups) {
    const rawCategoryId = group.family?.categoryId ?? group.lead.categoryId ?? null;
    const categoryId = rawCategoryId !== null && knownCategoryIds.has(rawCategoryId)
      ? rawCategoryId : null;
    let section = sections.get(categoryId);
    if (!section) {
      section = {
        key: categoryId === null ? 'without-category' : `category-${categoryId}`,
        categoryId,
        name: categoryId === null
          ? 'Zonder categorie'
          : categoryById.get(categoryId)?.name ?? 'Zonder categorie',
        groups: [],
        productCount: 0,
      };
      sections.set(categoryId, section);
    }
    section.groups.push(group);
    section.productCount += group.products.length;
  }
  return [...sections.values()].sort((left, right) =>
    categoryOrder(left.categoryId, categoryRank) - categoryOrder(right.categoryId, categoryRank));
}

export function productPickerGroupSummary(group: ProductPickerFamilyGroup): string {
  const parts: string[] = [];
  if (group.colours.length > 1) parts.push(`${group.colours.length} kleuren`);
  if (group.sizes.length > 1) parts.push(`${group.sizes.length} maten`);
  return parts.length ? parts.join(' · ') : `${group.products.length} variant${group.products.length === 1 ? '' : 'en'}`;
}

export function productPickerVariantLabel(product: Product): string {
  const parts = [product.colour, product.variantSize]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return parts.join(' · ') || product.name;
}

export function productPickerFamilySelectionState(
  group: ProductPickerFamilyGroup,
  selected: ReadonlyMap<number, ProductPickerSelectionEntry>,
): ProductPickerFamilySelectionState {
  const selectable = group.products.filter((product) => product.id !== null);
  const count = selectable.filter((product) => selected.has(product.id!)).length;
  if (!count) return 'none';
  return count === selectable.length ? 'all' : 'partial';
}

/** Select a complete range, or clear it when every available variant is selected. */
export function toggleProductPickerFamilySelection(
  group: ProductPickerFamilyGroup,
  selected: ReadonlyMap<number, ProductPickerSelectionEntry>,
): Map<number, ProductPickerSelectionEntry> {
  const deselect = productPickerFamilySelectionState(group, selected) === 'all';
  const next = new Map(selected);
  for (const product of group.products) {
    if (product.id === null) continue;
    if (deselect) next.delete(product.id);
    else if (!next.has(product.id)) {
      next.set(product.id, {
        product,
        quantity: Math.max(1, product.carton.piecesPerCarton ?? 1),
      });
    }
  }
  return next;
}

function compareGroups(
  left: ProductPickerFamilyGroup,
  right: ProductPickerFamilyGroup,
  sourceRank: ReadonlyMap<Product, number>,
): number {
  return nullableNumber(left.family?.productPosition, right.family?.productPosition)
    || compareText(left.name, right.name)
    || (sourceRank.get(left.products[0]) ?? 0) - (sourceRank.get(right.products[0]) ?? 0);
}

function groupSearchText(
  group: ProductPickerFamilyGroup,
  categories: readonly Category[],
): string {
  const categoryId = group.family?.categoryId ?? group.lead.categoryId;
  const category = categories.find((item) => item.id === categoryId)?.name ?? '';
  return normalize([
    group.name,
    group.family?.familyKey,
    category,
    ...group.products.flatMap((product) => [
      product.name,
      product.sku,
      product.colour,
      product.variantSize,
      product.describedAs,
      product.barcodeInner,
      product.barcodeOuter,
    ]),
  ].join(' '));
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

function categoryOrder(categoryId: number | null, ranks: ReadonlyMap<number, number>): number {
  if (categoryId === null) return Number.MAX_SAFE_INTEGER;
  return ranks.get(categoryId) ?? Number.MAX_SAFE_INTEGER - 1;
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

function isRed(colour: string | null | undefined): boolean {
  const value = normalize(colour ?? '');
  return value === 'rood' || value === 'red' || value === 'rouge' || value === 'rot';
}

function nullableNumber(
  left: number | null | undefined,
  right: number | null | undefined,
): number {
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

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('nl-BE');
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
