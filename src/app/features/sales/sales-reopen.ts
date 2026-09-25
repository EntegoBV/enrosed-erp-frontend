import type { SalesOrderView } from '../../core/api/models';

/**
 * Local visibility only: the API also checks retained receipts and dependent
 * settlements. An invoice with a live credit note (concept included) stays
 * as it is; a credit note whose goods went back into stock stays issued.
 */
export function canReopenSalesDocument(view: SalesOrderView | null | undefined): boolean {
  if (!view) return false;
  const order = view.order;
  return ['VERZONDEN', 'UITGEREIKT', 'BEKEKEN', 'AFGEWEZEN', 'VERLOPEN', 'GEANNULEERD'].includes(order.status)
    && !order.archivedAt && !order.paidAt && !order.goodsShippedAt && !order.signedByName && !order.goodsReturnedAt
    && !(view.paymentSummary?.payments?.length)
    && !(view.creditNotes?.length)
    && !((order.docType ?? 'OFFERTE') === 'OFFERTE' && view.invoicedAsId);
}
