import type { SalesOrder, SalesOrderLine, SalesOrderView } from '../../core/api/models';

type AvailabilityLine = { unavailable?: boolean | null; requestedQuantity?: number | null; quantity: number };

export function salesLineUnavailable(line: { unavailable?: boolean | null } | null | undefined): boolean {
  return line?.unavailable === true;
}

export function salesUnavailableLineCount(lines: readonly { unavailable?: boolean | null }[]): number {
  return lines.filter(salesLineUnavailable).length;
}

export function salesLineRequestedQuantity(line: AvailabilityLine | null | undefined): number | null {
  const quantity = line?.requestedQuantity;
  return typeof quantity === 'number' && Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}

export function salesAllProductsUnavailable(view: SalesOrderView | null | undefined): boolean {
  return !!view?.order.lines?.length && view.order.lines.every(salesLineUnavailable);
}

export function salesAvailabilityBlockReason(view: SalesOrderView | null | undefined): string | null {
  if (!view) return 'Laad eerst de order.';
  const order = view.order, payments = view.paymentSummary;
  if ((order.purpose ?? (order.partnerPurchaseOrderId ? 'PARTNER_ADVANCE' : 'STANDARD')) !== 'STANDARD' || view.advanceAgreement || view.advanceContents || view.settlement) return 'Partnerfacturen worden via hun container beheerd.';
  if (order.archivedAt || order.status !== 'CONCEPT' || order.sentAt || order.viewedAt || (order.viewCount ?? 0) > 0
    || view.invoicedAsId || view.invoicedAs || order.decidedAt || order.goodsShippedAt || order.paidAt
    || payments?.legacyPaidMarker || payments?.payments?.length || (payments?.grossReceivedEur ?? 0) > 0
    || (payments?.receivedEur ?? 0) > 0 || (payments?.refundedEur ?? 0) > 0) return 'Beschikbaarheid wijzigen kan alleen op een ongebruikt concept.';
  return null;
}

/** Preserve the remembered allocation; never derive a restore amount from stock or the catalogue. */
export function salesLineWithAvailability(line: SalesOrderLine, unavailable: boolean, restoreQuantity?: number): SalesOrderLine | null {
  if (unavailable) return { ...line, unavailable: true, quantity: 0,
    requestedQuantity: line.quantity > 0 ? line.quantity : salesLineRequestedQuantity(line) };
  const quantity = restoreQuantity ?? salesLineRequestedQuantity(line);
  if (quantity == null || !Number.isSafeInteger(quantity) || quantity <= 0) return null;
  return { ...line, unavailable: false, quantity, requestedQuantity: quantity };
}

/** A split line may only be parked/restored at its exact remembered allocation; prices remain frozen. */
export function salesFrozenLineChangeAllowed(before: SalesOrderLine, after: SalesOrderLine): boolean {
  const { deliveryWeek: _oldWeek, ...oldLine } = before;
  const { deliveryWeek: _newWeek, ...newLine } = after;
  if (JSON.stringify(oldLine) === JSON.stringify(newLine)) return true;
  if (salesLineUnavailable(before) === salesLineUnavailable(after)) return false;
  const expected = salesLineWithAvailability(before, salesLineUnavailable(after));
  if (!expected) return false;
  const { deliveryWeek: _expectedWeek, ...expectedLine } = expected;
  return JSON.stringify(expectedLine) === JSON.stringify(newLine);
}

export function salesPalletsWithoutUnavailable(order: SalesOrder): SalesOrder['pallets'] {
  const excluded = new Set(order.lines.filter(salesLineUnavailable).map(line => line.productId));
  return order.pallets.flatMap(pallet => {
    const items = pallet.items.filter(item => !excluded.has(item.productId));
    if (items.length === pallet.items.length) return [pallet];
    return items.length ? [{ ...pallet, items }] : [];
  });
}
