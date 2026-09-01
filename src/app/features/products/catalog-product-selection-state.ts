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
