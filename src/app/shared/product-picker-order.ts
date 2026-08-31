import type { Product } from '../core/api/models';

/**
 * Purchase orders receive the catalogue order from the backend. Other picker
 * contexts keep their established colour-first order.
 */
export function orderPickerProducts(
  products: readonly Product[], preserveSourceOrder: boolean,
): Product[] {
  if (preserveSourceOrder) return [...products];
  return [...products].sort((a, b) =>
    Number(!a.colour) - Number(!b.colour)
    || (a.colour ?? '').localeCompare(b.colour ?? '', 'nl')
    || a.name.localeCompare(b.name, 'nl'));
}

/** Keep a multi-select batch in the same order as the source, not click order. */
export function orderPickerBatch<T extends { product: Product }>(
  entries: readonly T[], products: readonly Product[], preserveSourceOrder: boolean,
): T[] {
  if (!preserveSourceOrder) return [...entries];

  const byReference = new Map(products.map((product, index) => [product, index]));
  const byId = new Map(products.flatMap((product, index) =>
    product.id === null ? [] : [[product.id, index] as const]));
  const rank = (product: Product): number =>
    (product.id === null ? undefined : byId.get(product.id))
    ?? byReference.get(product)
    ?? Number.MAX_SAFE_INTEGER;

  return [...entries].sort((left, right) => rank(left.product) - rank(right.product));
}
