import type { Product, StockLevel } from '../../core/api/models';

/**
 * Voorraad and Overzicht count every stock location (critique N14, the
 * products round: /stock shows "Waarde tegen kostprijs · alle locaties").
 * A product's stockQuantity is the warehouse only; this returns the products
 * with stockQuantity = sales-unit equivalents over all locations. Loose
 * pieces contribute their share of a display to valuations, without rounding
 * the stored stock or excluding an opened display. A product
 * without any level row keeps its own figure. Pure, type-only imports
 * (node-tested, tests/analyses-stock.test.mts).
 */
export function withAllLocations<T extends Pick<Product, 'id' | 'stockQuantity'>>(products: readonly T[], levels: readonly StockLevel[]): T[] {
  const sums = new Map<number, number>();
  for (const level of levels) {
    if (!Number.isFinite(level.quantity)) continue;
    const factor = Number.isInteger(level.piecesPerUnit) && level.piecesPerUnit! > 0 ? level.piecesPerUnit! : 1;
    const loose = Number.isFinite(level.loosePieces) ? level.loosePieces! : 0;
    sums.set(level.productId, (sums.get(level.productId) ?? 0) + level.quantity + loose / factor);
  }
  return products.map((product) => {
    const sum = product.id === null ? undefined : sums.get(product.id);
    return sum === undefined || sum === product.stockQuantity ? product : { ...product, stockQuantity: sum };
  });
}
