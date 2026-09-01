import type { Category, PricedLine, Product, ProductFamily } from '../../core/api/models';
import { productPickerFamilySections } from '../../shared/product-picker-family-groups';

export interface SalesLineFamilyGroup {
  key: string;
  familyId: number | null;
  label: string;
  lines: PricedLine[];
  swatches: { key: string; label: string; hex: string | null }[];
  pieces: number;
  cartons: number;
  cbm: number;
  totalEur: number;
}

export interface SalesLineSection {
  key: string;
  label: string;
  lines: PricedLine[];
  families: SalesLineFamilyGroup[];
}

/**
 * Project priced sales rows onto the catalogue hierarchy without changing
 * the order payload: category -> product range -> colour/size variants.
 */
export function salesLineSections(
  lines: readonly PricedLine[],
  products: readonly Product[],
  categories: readonly Category[],
  families: readonly ProductFamily[],
): SalesLineSection[] {
  const lineByProductId = new Map(lines.map((line) => [line.productId, line] as const));
  const lineProducts = products.filter((product) =>
    product.id !== null && lineByProductId.has(product.id));
  const seen = new Set<number>();

  const sections: SalesLineSection[] = productPickerFamilySections(
    lineProducts,
    families,
    categories,
    { query: '', category: null, limit: Number.MAX_SAFE_INTEGER },
  ).map((section) => {
    const grouped = section.groups.map((group): SalesLineFamilyGroup => {
      const groupLines = group.products.flatMap((product) => {
        const line = product.id === null ? undefined : lineByProductId.get(product.id);
        if (!line) return [];
        seen.add(line.productId);
        return [line];
      });
      return {
        key: group.key,
        familyId: group.family?.id ?? null,
        label: group.name,
        lines: groupLines,
        swatches: group.colours.map((colour) => ({
          key: colour.name.toLocaleLowerCase('nl-BE'),
          label: colour.name,
          hex: colour.hex,
        })),
        pieces: sum(groupLines, (line) => line.quantity),
        cartons: sum(groupLines, (line) => line.cartons),
        cbm: sum(groupLines, (line) => line.cbm),
        totalEur: sum(groupLines, (line) => line.net),
      };
    }).filter((group) => group.lines.length > 0);
    return {
      key: section.key,
      label: section.name,
      lines: grouped.flatMap((group) => group.lines),
      families: grouped,
    };
  }).filter((section) => section.lines.length > 0);

  const missing = lines.filter((line) => !seen.has(line.productId));
  if (missing.length) {
    sections.push({
      key: 'without-category-fallback',
      label: 'Zonder categorie',
      lines: [...missing],
      families: missing.map((line) => ({
        key: `product-${line.productId}`,
        familyId: null,
        label: line.description,
        lines: [line],
        swatches: [],
        pieces: line.quantity,
        cartons: line.cartons,
        cbm: line.cbm,
        totalEur: line.net,
      })),
    });
  }
  return sections;
}

function sum(lines: readonly PricedLine[], value: (line: PricedLine) => number): number {
  return lines.reduce((total, line) => total + (Number.isFinite(value(line)) ? value(line) : 0), 0);
}
