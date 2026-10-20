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

/** Format only exact opened displays; whole selling units keep their existing wording. */
export function fractionalDisplayCount(quantity: number, piecesPerDisplay: number | null | undefined,
                                       piece: { one: string; other: string }): string | null {
  if (!Number.isFinite(quantity) || !Number.isInteger(piecesPerDisplay) || piecesPerDisplay! <= 1) return null;
  const physical = quantity * piecesPerDisplay!;
  const rounded = Math.round(physical);
  if (!Number.isSafeInteger(rounded) || Math.abs(physical - rounded) > 0.0000001) return null;
  const absolute = Math.abs(rounded);
  const complete = Math.floor(absolute / piecesPerDisplay!);
  const loose = absolute % piecesPerDisplay!;
  if (loose === 0) return null;
  const sign = rounded < 0 ? '−' : '';
  const display = complete ? `${complete.toLocaleString('nl-BE')} ${complete === 1 ? 'display' : 'displays'} ${rounded < 0 ? '−' : '+'} ` : '';
  return `${sign}${display}${loose.toLocaleString('nl-BE')} losse ${loose === 1 ? piece.one : piece.other}`;
}
