import type {
  Category,
  LandedCostLine,
  Product,
  ProductFamily,
} from '../../core/api/models';

const collator = new Intl.Collator('nl-BE', {
  numeric: true,
  sensitivity: 'base',
});

export interface PurchaseLineEntry {
  line: LandedCostLine;
  product: Product | null;
  displayIndex: number;
}

export interface PurchaseLineSwatch {
  label: string;
  hex: string | null;
}

export interface PurchaseLineTotals {
  pieces: number;
  cartons: number;
  cbm: number;
  goodsEur: number;
  totalEur: number;
  averageUnitEur: number;
}

/** One customer-facing model and the colour/size SKUs ordered from it. */
export interface PurchaseLineFamilyGroup {
  key: string;
  familyId: number | null;
  /** Canonical position of the model inside its category, when available. */
  position: number | null;
  /** True only for a product that is not linked to a product family. */
  standalone: boolean;
  name: string;
  photoUrl: string | null;
  swatches: PurchaseLineSwatch[];
  entries: PurchaseLineEntry[];
  totals: PurchaseLineTotals;
}

export interface PurchaseLineSection {
  key: string;
  name: string;
  lineCount: number;
  groups: PurchaseLineFamilyGroup[];
  totals: PurchaseLineTotals;
}

interface SourceEntry {
  line: LandedCostLine;
  product: Product | null;
  family: ProductFamily | null;
  sourceIndex: number;
}

/**
 * Build the same hierarchy people use in the product overview:
 * category -> product model -> colour/size variants.
 *
 * Colour is deliberately never a global filter or grouping key. Two blue
 * products from different model families therefore remain in different
 * cards. Products without a family remain simple one-line cards.
 */
export function purchaseLineSections(
  lines: readonly LandedCostLine[],
  products: readonly Product[],
  categories: readonly Category[],
  families: readonly ProductFamily[],
  colourSwatches: Readonly<Record<string, string>>,
): PurchaseLineSection[] {
  const productsById = new Map(products.flatMap((product) =>
    product.id === null ? [] : [[product.id, product] as const]));
  const familiesById = new Map(families.flatMap((family) =>
    family.id === null ? [] : [[family.id, family] as const]));
  const categoriesById = new Map(categories.flatMap((category) =>
    category.id === null ? [] : [[category.id, category] as const]));
  const categoryRank = new Map(
    [...categories]
      .map((category, index) => ({ category, index }))
      .sort((left, right) => left.category.position - right.category.position || left.index - right.index)
      .flatMap(({ category }, index) => category.id === null ? [] : [[category.id, index] as const]),
  );

  const sourceEntries: SourceEntry[] = lines.map((line, sourceIndex) => {
    const product = productsById.get(line.productId) ?? null;
    const family = product?.familyId === null || product?.familyId === undefined
      ? null
      : familiesById.get(product.familyId) ?? null;
    return { line, product, family, sourceIndex };
  });

  const sectionEntries = new Map<number | null, SourceEntry[]>();
  for (const entry of sourceEntries) {
    const categoryId = entry.family?.categoryId ?? entry.product?.categoryId ?? null;
    const entries = sectionEntries.get(categoryId) ?? [];
    entries.push(entry);
    sectionEntries.set(categoryId, entries);
  }

  const orderedSections = [...sectionEntries.entries()].sort(([leftId], [rightId]) =>
    categoryOrder(leftId, categoryRank) - categoryOrder(rightId, categoryRank)
      || nullableNumber(leftId, rightId));

  let displayIndex = 0;
  return orderedSections.map(([categoryId, entries]) => {
    const grouped = new Map<string, SourceEntry[]>();
    for (const entry of entries) {
      const key = purchaseFamilyGroupKey(entry.product, entry.line);
      const groupEntries = grouped.get(key) ?? [];
      groupEntries.push(entry);
      grouped.set(key, groupEntries);
    }

    const groups = [...grouped.entries()]
      .map(([key, groupEntries]) => buildFamilyGroup(
        key,
        groupEntries,
        productsById,
        colourSwatches,
      ))
      .sort(compareFamilyGroups);

    for (const group of groups) {
      group.entries = group.entries.map((entry) => ({
        ...entry,
        displayIndex: ++displayIndex,
      }));
    }

    return {
      key: categoryId === null ? 'none' : `category-${categoryId}`,
      name: categoryId === null
        ? 'Zonder categorie'
        : categoriesById.get(categoryId)?.name ?? 'Onbekende categorie',
      lineCount: groups.reduce((sum, group) => sum + group.entries.length, 0),
      groups,
      totals: sumTotals(groups.flatMap((group) => group.entries.map((entry) => entry.line))),
    };
  });
}

function buildFamilyGroup(
  key: string,
  sourceEntries: readonly SourceEntry[],
  productsById: ReadonlyMap<number, Product>,
  colourSwatches: Readonly<Record<string, string>>,
): PurchaseLineFamilyGroup {
  const first = sourceEntries[0];
  const familyId = first.product?.familyId ?? null;
  const family = first.family;
  const memberPosition = new Map((family?.members ?? []).map((member) => [member.productId, member.position]));
  const ordered = [...sourceEntries].sort((left, right) =>
    nullableNumber(memberPosition.get(left.line.productId), memberPosition.get(right.line.productId))
      || nullableNumber(left.product?.variantPosition, right.product?.variantPosition)
      || compareText(variantKey(left.product), variantKey(right.product), true)
      || compareText(left.product?.variantSize, right.product?.variantSize, true)
      || compareText(left.product?.sku, right.product?.sku, true)
      || left.sourceIndex - right.sourceIndex);
  const lead = ordered[0];

  const entries: PurchaseLineEntry[] = ordered.map((entry) => ({
    line: entry.line,
    product: entry.product,
    displayIndex: 0,
  }));
  const preferredPhoto = family?.cardFeaturedProductId === null
    || family?.cardFeaturedProductId === undefined
    ? null
    : productsById.get(family.cardFeaturedProductId)?.photos?.[0]?.url ?? null;
  const familyPhoto = [...(family?.images ?? [])]
    .sort((left, right) => left.position - right.position)[0]?.smallUrl ?? null;
  const variantPhoto = ordered.find((entry) => entry.product?.photos?.[0]?.url)
    ?.product?.photos?.[0]?.url ?? null;

  return {
    key,
    familyId,
    position: Number.isFinite(family?.productPosition) ? Number(family?.productPosition) : null,
    standalone: familyId === null,
    name: family?.name?.trim()
      || fallbackProductFamilyName(lead.product, lead.line.productName),
    photoUrl: preferredPhoto || familyPhoto || variantPhoto,
    swatches: distinctSwatches(entries, colourSwatches),
    entries,
    totals: sumTotals(entries.map((entry) => entry.line)),
  };
}

function purchaseFamilyGroupKey(product: Product | null, line: LandedCostLine): string {
  return product?.familyId === null || product?.familyId === undefined
    ? `product:${line.productId}`
    : `family:${product.familyId}`;
}

function compareFamilyGroups(left: PurchaseLineFamilyGroup, right: PurchaseLineFamilyGroup): number {
  return nullableNumber(left.position, right.position)
    || compareText(left.name, right.name)
    || familyPosition(left) - familyPosition(right)
    || compareText(left.key, right.key);
}

/** Older products have no family order, so their first variant is a stable fallback. */
function familyPosition(group: PurchaseLineFamilyGroup): number {
  const positions = group.entries
    .map((entry) => entry.product?.variantPosition)
    .filter((position): position is number => position !== null && position !== undefined);
  return positions.length ? Math.min(...positions) : Number.MAX_SAFE_INTEGER;
}

function distinctSwatches(
  entries: readonly PurchaseLineEntry[],
  colourSwatches: Readonly<Record<string, string>>,
): PurchaseLineSwatch[] {
  const swatches = new Map<string, PurchaseLineSwatch>();
  for (const entry of entries) {
    const label = entry.product?.colour?.trim() || 'Zonder kleur';
    const key = label.toLocaleLowerCase('nl-BE');
    if (swatches.has(key)) continue;
    swatches.set(key, {
      label,
      hex: purchaseColourHex(entry.product, colourSwatches),
    });
  }
  return [...swatches.values()];
}

function sumTotals(lines: readonly LandedCostLine[]): PurchaseLineTotals {
  const totals = lines.reduce((sum, line) => ({
    pieces: sum.pieces + finite(line.quantity),
    cartons: sum.cartons + finite(line.cartons),
    cbm: sum.cbm + finite(line.cbm),
    goodsEur: sum.goodsEur + finite(line.goodsEur),
    totalEur: sum.totalEur + finite(line.totalEur),
  }), { pieces: 0, cartons: 0, cbm: 0, goodsEur: 0, totalEur: 0 });
  return {
    ...totals,
    averageUnitEur: totals.pieces > 0 ? totals.totalEur / totals.pieces : 0,
  };
}

function finite(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function categoryOrder(categoryId: number | null, ranks: ReadonlyMap<number, number>): number {
  if (categoryId === null) return Number.MAX_SAFE_INTEGER;
  return ranks.get(categoryId) ?? Number.MAX_SAFE_INTEGER - 1;
}

function colourLabel(product: Product | null): string | null {
  return product?.colour?.trim() || null;
}

export function purchaseColourHex(
  product: Product | null,
  colourSwatches: Readonly<Record<string, string>>,
): string | null {
  const label = colourLabel(product);
  if (product?.colourHex?.trim()) return product.colourHex.trim();
  if (!label) return null;
  return Object.entries(colourSwatches).find(([name]) => collator.compare(name, label) === 0)?.[1] ?? null;
}

/** Same stable variant key used by the product overview and purchase editor. */
function variantKey(product: Product | null): string | null {
  if (!product) return null;
  const canonical = product.canonicalVariantKey?.trim();
  if (canonical) {
    const family = product.familyKey?.trim();
    if (family && canonical.startsWith(`${family}-`)) return canonical.slice(family.length + 1);
    return canonical;
  }
  return product.colour?.trim() || null;
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
