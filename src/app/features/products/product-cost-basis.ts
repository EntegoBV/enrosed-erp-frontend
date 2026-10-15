import { productSalesUnit } from './product-sales-unit';
import type { Product, ProductCostHistoryEntry } from '../../core/api/models';

/*
 * The basis a landed cost holds on: per display of n pieces or per piece,
 * and what one piece is called. The cost history keeps it with every row,
 * because a product can change its basis later without its cost being
 * converted. The words come from productSalesUnit, so a cost reads "per
 * display van 12" or "per diamant" like every other price in the ERP.
 * Its own file because it needs that helper at run time; node tests load it
 * through the TypeScript transpiler (tests/product-cost-history.test.mts).
 */

/** Effective values, as the server stores them (ProductCostBasis.of). */
export interface CostBasis {
  salesUnit: 'PIECE' | 'DISPLAY';
  /** Pieces in one display; null unless a display of two or more. */
  piecesPerUnit: number | null;
  /** A unit-names key, never blank ("stuk" when none was chosen). */
  unitKey: string;
}

/** The cost on the other side of a display, to four decimals like the cost itself. */
export interface OtherSideCost {
  /** "=" when exact to four decimals, "≈" when rounded. */
  sign: '=' | '≈';
  price: number;
  /** "per roos" for a cost per display, "per display van 12" for a cost per piece. */
  per: string;
}

const cleanKey = (key: string | null | undefined): string => key?.trim().toLowerCase() || 'stuk';
const pieceCount = (count: number | null | undefined): number | null =>
  count != null && Number.isSafeInteger(count) && count > 1 ? count : null;

/** A product's basis today, the way the server would store it. */
export function productCostBasis(product: Pick<Product, 'packaging'> | null | undefined): CostBasis {
  const unit = productSalesUnit(product);
  return {
    salesUnit: unit.isDisplay ? 'DISPLAY' : 'PIECE',
    piecesPerUnit: unit.piecesPerDisplay,
    unitKey: cleanKey(product?.packaging?.unitKey),
  };
}

/** A history row's stored basis; a row without one (written before it was kept) reads on the fallback. */
export function entryCostBasis(entry: Pick<ProductCostHistoryEntry, 'salesUnit' | 'piecesPerUnit' | 'unitKey'>, fallback: CostBasis): CostBasis {
  if (entry.salesUnit == null && entry.piecesPerUnit == null && entry.unitKey == null) return fallback;
  return {
    salesUnit: entry.salesUnit === 'DISPLAY' ? 'DISPLAY' : 'PIECE',
    piecesPerUnit: pieceCount(entry.piecesPerUnit),
    unitKey: cleanKey(entry.unitKey),
  };
}

export function sameCostBasis(left: CostBasis, right: CostBasis): boolean {
  return left.salesUnit === right.salesUnit && left.piecesPerUnit === right.piecesPerUnit && left.unitKey === right.unitKey;
}

/** productSalesUnit of a basis: a pseudo-product with just the packaging the words need. */
function basisUnit(basis: CostBasis) {
  const display = basis.salesUnit === 'DISPLAY' || basis.piecesPerUnit !== null;
  return productSalesUnit({ packaging: {
    kind: display ? 'DISPLAY' : 'NONE', salesUnit: basis.salesUnit, piecesPerUnit: basis.piecesPerUnit, unitKey: basis.unitKey,
  } as Product['packaging'] });
}

export interface CostWords {
  /** "per display van 12", "per display", "per diamant", "per stuk". */
  per: string;
  /** The same without "per", for a sentence: "display van 12", "diamant". */
  unit: string;
  singular: string;
  plural: string;
}

export function costWords(basis: CostBasis): CostWords {
  const unit = basisUnit(basis);
  const count = unit.piecesPerDisplay;
  const what = unit.isDisplay ? (count ? `display van ${count.toLocaleString('nl-BE')}` : 'display') : unit.piece.one;
  return { per: `per ${what}`, unit: what, singular: unit.singular, plural: unit.plural };
}

/** "500 displays", "1 display", "2.000 diamanten". */
export function costQuantity(basis: CostBasis, quantity: number): string {
  const words = costWords(basis);
  return `${quantity.toLocaleString('nl-BE')} ${quantity === 1 ? words.singular : words.plural}`;
}

/**
 * The other side of a display: a cost per display of 12 roses also reads per
 * roos, a cost per diamant in a display of 12 also reads per display. Null
 * without a display of two or more, or without a cost.
 */
export function otherSideCost(basis: CostBasis, value: number | null | undefined): OtherSideCost | null {
  const unit = basisUnit(basis);
  const pieces = unit.piecesPerDisplay;
  if (!pieces || value == null || !Number.isFinite(value) || value <= 0) return null;
  const price = unit.isDisplay ? value / pieces : value * pieces;
  const scaled = price * 10000;
  const sign = Math.abs(scaled - Math.round(scaled)) < 1e-6 ? '=' : '≈';
  const per = unit.isDisplay ? unit.piece.per : `per display van ${pieces.toLocaleString('nl-BE')}`;
  return { sign, price: Math.round(scaled) / 10000, per };
}
