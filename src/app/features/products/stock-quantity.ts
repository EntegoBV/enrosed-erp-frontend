import type { Product, StockMovement } from '../../core/api/models';
import { productSalesUnit } from './product-sales-unit';

export interface StockAmount { quantity: number; loosePieces?: number; piecesPerUnit?: number }
type ProductUnit = Pick<Product, 'packaging'> | null | undefined;
const number = (value: number) => value.toLocaleString('nl-BE');

/** Loose physical contents stay visible beside complete sales units. Never show a rounded fraction of a display. */
export function looseStockText(loosePieces: number | null | undefined, product?: ProductUnit): string {
  if (!loosePieces) return '';
  const piece = productSalesUnit(product).piece;
  return `${number(loosePieces)} losse ${Math.abs(loosePieces) === 1 ? piece.one : piece.other}`;
}
export function stockAmountText(level: StockAmount, product: ProductUnit): string {
  const unit = productSalesUnit(product);
  const display = level.piecesPerUnit == null ? unit.isDisplay : level.piecesPerUnit > 1;
  const one = display ? 'display' : unit.piece.one, other = display ? 'displays' : unit.piece.other;
  const whole = `${number(level.quantity)} ${Math.abs(level.quantity) === 1 ? one : other}`;
  return level.loosePieces ? `${whole} + ${looseStockText(level.loosePieces, product)}` : whole;
}
export function stockMovementDelta(move: Pick<StockMovement, 'delta' | 'sourceUnit' | 'looseDelta' | 'unitPieces'>, product: ProductUnit): string {
  const unit = productSalesUnit(product);
  const physical = move.sourceUnit === 'PIECE' || !!move.looseDelta;
  const delta = physical ? move.delta * (move.unitPieces || 1) + (move.looseDelta ?? 0) : move.delta;
  const display = move.unitPieces == null ? unit.isDisplay : move.unitPieces > 1;
  const label = physical || !display ? (Math.abs(delta) === 1 ? unit.piece.one : unit.piece.other) : (Math.abs(delta) === 1 ? 'display' : 'displays');
  return `${delta > 0 ? '+' : ''}${number(delta)} ${label}`;
}
export function stockMovementAfter(move: Pick<StockMovement, 'quantityAfter' | 'loosePiecesAfter' | 'unitPieces'>, product: ProductUnit): string {
  return stockAmountText({ quantity: move.quantityAfter, loosePieces: move.loosePiecesAfter, piecesPerUnit: move.unitPieces ?? undefined }, product);
}
