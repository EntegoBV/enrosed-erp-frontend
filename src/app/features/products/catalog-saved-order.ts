import type { Product } from '../../core/api/models';
import { applyCatalogProductOrder } from './catalog-product-order';

/** Use the current full catalogue so hidden products retain their saved positions. */
export function normalizedCatalogOrderIds(
  products: readonly Product[],
  orderedIds: readonly number[],
): number[] {
  return applyCatalogProductOrder(products, orderedIds).map(product => product.id!);
}

/** A saved server order, including an explicit reset, supersedes the browser draft. */
export function initialCatalogOrderIds(
  products: readonly Product[],
  saved: { revision: number; orderedIds: readonly number[] },
  localDraftIds: readonly number[],
): number[] {
  return normalizedCatalogOrderIds(products, saved.revision > 0 ? saved.orderedIds : localDraftIds);
}

/** Catalogue additions and removals alone do not count as a manual order change. */
export function catalogOrderChanged(
  products: readonly Product[],
  currentIds: readonly number[],
  savedIds: readonly number[],
): boolean {
  const current = normalizedCatalogOrderIds(products, currentIds);
  const saved = normalizedCatalogOrderIds(products, savedIds);
  return current.length !== saved.length || current.some((id, index) => id !== saved[index]);
}
