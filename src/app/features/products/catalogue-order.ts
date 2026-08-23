import { Category, Product } from '../../core/api/models';

/**
 * Every product in the order the catalogue list shows them by default:
 * the categories in their own order, then names the Belgian way. The
 * prev/next arrows on the product screens step through this order, so
 * browsing matches the list you came from.
 */
export function orderLikeTheList(products: Product[], categories: Category[]): Product[] {
  const rank = new Map(categories.map((category, index) => [category.id, index]));
  const byName = (a: Product, b: Product) =>
    a.name.localeCompare(b.name, 'nl', { numeric: true, sensitivity: 'base' })
    || (a.sku ?? '').localeCompare(b.sku ?? '', 'nl', { numeric: true });
  return [...products].sort((a, b) =>
    ((a.categoryId == null ? Infinity : rank.get(a.categoryId) ?? Infinity)
      - (b.categoryId == null ? Infinity : rank.get(b.categoryId) ?? Infinity))
    || byName(a, b));
}
