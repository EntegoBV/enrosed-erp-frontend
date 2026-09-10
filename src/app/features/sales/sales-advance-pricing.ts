import type { PurchaseOrderView, SalesOrderView } from '../../core/api/models';
import { advanceContentsFor } from './sales-advance-contents-state';

const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Internal, current purchase prices. The invoice's frozen cargo and monetary claim are never repriced. */
export function advancePurchasePricing(view: SalesOrderView, purchase: PurchaseOrderView | null) {
  const contents = advanceContentsFor(view);
  if (!contents || purchase?.order.id !== contents.purchaseOrderId || !purchase.costing?.lines) return null;
  const costs = purchase.costing.lines;
  const frozenIds = new Set(contents.lines.map(line => line.productId));
  const lines = contents.lines.map(line => {
    const matches = costs.filter(cost => cost.productId === line.productId);
    // Multiple rows for the same product cannot safely be assigned to a single frozen cargo row.
    const cost = matches.length === 1 && contents.lines.filter(row => row.productId === line.productId).length === 1
      ? matches[0] : null;
    const quantity = finite(cost?.quantity);
    return {
      unitPriceEur: finite(cost?.landedUnitEur),
      totalEur: finite(cost?.totalEur),
      quantity,
      quantityDiffers: quantity != null && quantity !== line.quantity,
    };
  });
  const totals = purchase.costing.totals;
  return {
    lines,
    contentsDiffer: lines.some(line => line.quantity == null || line.quantityDiffers)
      || costs.some(line => !frozenIds.has(line.productId)),
    goodsTotalEur: finite(totals.totalEur),
    separateCostsEur: finite(totals.separateCostsEur),
    separateCostsIncluded: totals.separateCostsInPiecePrice === true,
    totalEur: finite(totals.totalWithSeparateCostsEur),
  };
}
