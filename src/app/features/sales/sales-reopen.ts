import type { SalesOrderView } from '../../core/api/models';

/**
 * Local visibility only: the API also checks retained receipts and dependent
 * settlements. An invoice with a live credit note (concept included) stays
 * as it is; a credit note whose goods went back into stock stays issued.
 * A website order the customer cancelled stays cancelled: they ordered anew
 * or not at all, and the server refuses the reopen.
 */
export function canReopenSalesDocument(view: SalesOrderView | null | undefined): boolean {
  if (!view) return false;
  const order = view.order;
  return ['VERZONDEN', 'UITGEREIKT', 'BEKEKEN', 'AFGEWEZEN', 'VERLOPEN', 'GEANNULEERD'].includes(order.status)
    && !order.archivedAt && !order.paidAt && !order.goodsShippedAt && !order.signedByName && !order.goodsReturnedAt
    && !(view.paymentSummary?.payments?.length)
    && !(view.creditNotes?.length)
    && !((order.docType ?? 'OFFERTE') === 'OFFERTE' && view.invoicedAsId)
    && !view.webOrder?.customerCancelledAt;
}
