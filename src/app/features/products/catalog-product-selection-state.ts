/** Add valid product IDs without mutating the current selection. */
export function selectProductIds(
  current: ReadonlySet<number>,
  productIds: Iterable<number | null | undefined>,
): Set<number> {
  const next = new Set(current);
  for (const id of productIds) {
    if (id !== null && id !== undefined) next.add(id);
  }
  return next;
}

/** Remove valid product IDs without mutating the current selection. */
export function deselectProductIds(
  current: ReadonlySet<number>,
  productIds: Iterable<number | null | undefined>,
): Set<number> {
  const next = new Set(current);
  for (const id of productIds) {
    if (id !== null && id !== undefined) next.delete(id);
  }
  return next;
}

export interface CatalogSelectionGroup<T> {
  key: string;
  categoryId: number | null;
  name: string;
  products: T[];
}

/**
 * Products in the order the categories are listed, uncategorised ones last,
 * so the chooser reads like the catalogue that will come out of it.
 */
export function groupProductsByCategory<T extends { categoryId: number | null }>(
  products: readonly T[],
  categories: readonly { id: number | null; name: string }[],
): CatalogSelectionGroup<T>[] {
  const groups = new Map<string, CatalogSelectionGroup<T>>();
  for (const category of categories) {
    if (category.id === null) continue;
    groups.set(`category:${category.id}`, { key: `category:${category.id}`, categoryId: category.id, name: category.name, products: [] });
  }
  const loose: CatalogSelectionGroup<T> = { key: 'category:none', categoryId: null, name: 'Zonder categorie', products: [] };
  for (const product of products) {
    const group = product.categoryId === null ? loose : groups.get(`category:${product.categoryId}`);
    if (group) group.products.push(product);
    else loose.products.push(product);
  }
  const ordered = [...groups.values()].filter((group) => group.products.length > 0);
  if (loose.products.length) ordered.push(loose);
  return ordered;
}

/**
 * A shift-click covers every row between the last toggled row and this one,
 * inclusive, and gives them all the state of the row that was clicked last.
 */
export function productIdsBetween(
  orderedIds: readonly (number | null)[],
  fromIndex: number,
  toIndex: number,
): number[] {
  if (!orderedIds.length) return [];
  const clamp = (index: number) => Math.min(orderedIds.length - 1, Math.max(0, index));
  const start = Math.min(clamp(fromIndex), clamp(toIndex));
  const end = Math.max(clamp(fromIndex), clamp(toIndex));
  return orderedIds.slice(start, end + 1).filter((id): id is number => id !== null);
}
