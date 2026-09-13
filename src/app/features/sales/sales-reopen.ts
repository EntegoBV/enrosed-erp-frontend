import type { SalesOrderView } from '../../core/api/models';

/** Local visibility only: the API also checks retained receipts and dependent settlements. */
export function canReopenSalesDocument(view: SalesOrderView | null | undefined): boolean {
  if (!view) return false;
  const order = view.order;
  return ['VERZONDEN', 'UITGEREIKT', 'BEKEKEN', 'AFGEWEZEN', 'VERLOPEN', 'GEANNULEERD'].includes(order.status)
    && !order.archivedAt && !order.paidAt && !order.goodsShippedAt && !order.signedByName
    && !(view.paymentSummary?.payments?.length)
    && !(order.docType !== 'FACTUUR' && view.invoicedAsId);
}
