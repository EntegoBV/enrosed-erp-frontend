import { productSalesUnit } from '../products/product-sales-unit';
import type { Product } from '../../core/api/models';

/**
 * The unit words of a count line or a closing product: the one adapter from
 * the flat `unitKey`, `salesUnit` and `piecesPerUnit` of the inventory types
 * to productSalesUnit. Its own file because it needs that helper at run time,
 * while inventory-count.ts and inventory-closing.ts stay type-imports only.
 */
export function inventoryUnit(row: { unitKey: string | null; salesUnit: 'PIECE' | 'DISPLAY'; piecesPerUnit: number | null }) {
  return productSalesUnit({ packaging: {
    kind: row.salesUnit === 'DISPLAY' ? 'DISPLAY' : 'NONE', salesUnit: row.salesUnit,
    piecesPerUnit: row.piecesPerUnit, unitKey: row.unitKey } as Product['packaging'] });
}
